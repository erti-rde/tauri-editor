//! SPIKE (M1b-1, ADR 003): do aliases hold? Throwaway: never merged.

use erti_lib::db::{queries, DbState};
use sqlx::Row;
use std::path::PathBuf;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("erti-spike-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

async fn project(name: &str) -> DbState {
    let dir = scratch(name);
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await.unwrap();
    state.open_project(&dir.join("Thesis")).await.unwrap();
    state
}

const BOOK: &str = r#"{"type":"book","title":"Read in print","author":[{"family":"Smith","given":"A"}],"issued":{"date-parts":[[2019]]}}"#;
const PAPER: &str = r#"{"type":"article-journal","title":"The preprint","author":[{"family":"Jones","given":"B"}],"issued":{"date-parts":[[2020]]}}"#;

fn chunk(text: &str, v: f32) -> queries::NewChunk {
    queries::NewChunk {
        text: text.into(),
        embedding: vec![v, 1.0 - v, 0.0],
        page_start: Some(1),
        page_end: Some(1),
        section: None,
        char_start: None,
        char_end: None,
    }
}

fn highlight(id: &str, sha: &str) -> queries::NewAnnotation {
    serde_json::from_value(serde_json::json!({
        "id": id, "sha256": sha, "kind": "highlight", "page": 1, "quote": "x"
    }))
    .unwrap()
}

async fn fk_violations(pool: &sqlx::SqlitePool) -> usize {
    sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(pool)
        .await
        .unwrap()
        .len()
}

/// AC-1 and AC-2: a no-file source, cited, then given its PDF.
#[tokio::test]
async fn attaching_a_pdf_to_a_cited_no_file_source() {
    let state = project("attach").await;
    let library = state.library().await.unwrap();
    let project = state.project().await.unwrap();

    // A book read in print: `erti:<uuid>`, in the project, cited by a manuscript.
    let work = "erti:7f8e1c2a-0000-4000-8000-000000000001";
    queries::add_source_without_file(&library, work, BOOK, Some("book"), None)
        .await
        .unwrap();
    queries::add_to_project(&project, work).await.unwrap();

    // Its PDF turns up: ingested as usual under its own hash, with chunks and a
    // highlight, then said to be the same work.
    let file = "a".repeat(64);
    queries::register_source(&library, &file, "/papers/book.pdf", "book.pdf")
        .await
        .unwrap();
    queries::store_chunks(&library, &file, &[chunk("from the book", 0.9)])
        .await
        .unwrap();
    queries::save_annotation(&library, &highlight("h1", &file))
        .await
        .unwrap();
    queries::alias_source(&library, &file, work).await.unwrap();

    // Every foreign key still holds, with foreign_keys = ON.
    assert_eq!(fk_violations(&library).await, 0);
    assert_eq!(queries::canonical(&library, &file).await.unwrap(), work);
    assert_eq!(queries::canonical(&library, work).await.unwrap(), work);

    // The cited id's row is untouched: what the manuscript renders from.
    let sources = queries::project_sources(&library, &project).await.unwrap();
    let cited = sources.iter().find(|s| s.sha256 == work).unwrap();
    assert_eq!(cited.csl_json.as_deref(), Some(BOOK));
    assert_eq!(cited.state, "ready");
    // Finding: the file's location hangs off the alias row, so "open PDF" on
    // the work needs the resolver too.
    assert_eq!(cited.path, None);

    // AC-2: a result from the PDF reports the work, and counts as in the project
    // although the set names only the uuid.
    let results = queries::search_similar(&library, &[1.0, 0.0, 0.0], &[work.into()], 5, false)
        .await
        .unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].sha256, work);
    assert!(results[0].in_project);
    assert_eq!(results[0].text, "from the book");

    // The highlight stays on the file it was drawn on.
    let marks = queries::annotations_for_source(&library, &file)
        .await
        .unwrap();
    assert_eq!(marks.len(), 1);
}

/// AC-3: two ids, each cited somewhere, merged.
#[tokio::test]
async fn merging_two_cited_ids() {
    let state = project("merge").await;
    let library = state.library().await.unwrap();
    let project = state.project().await.unwrap();

    // The preprint's PDF, cited by chapter 1; a no-file entry for the same paper
    // added by hand and cited by chapter 2.
    let preprint = "b".repeat(64);
    queries::register_source(&library, &preprint, "/papers/pre.pdf", "pre.pdf")
        .await
        .unwrap();
    queries::set_source_metadata(&library, &preprint, PAPER, None, None, "pdf-doi")
        .await
        .unwrap();
    queries::store_chunks(&library, &preprint, &[chunk("from the preprint", 0.8)])
        .await
        .unwrap();
    let by_hand = "erti:7f8e1c2a-0000-4000-8000-000000000002";
    queries::add_source_without_file(&library, by_hand, PAPER, None, None)
        .await
        .unwrap();
    queries::add_to_project(&project, &preprint).await.unwrap();
    queries::add_to_project(&project, by_hand).await.unwrap();

    // Both are cited, so the older (the preprint) stays canonical.
    queries::alias_source(&library, by_hand, &preprint)
        .await
        .unwrap();
    assert_eq!(fk_violations(&library).await, 0);
    assert_eq!(
        queries::canonical(&library, by_hand).await.unwrap(),
        preprint
    );

    // Finding: `project_sources` still lists both rows. The source list and the
    // citation map have to collapse them by canonical id (M1b-3).
    let sources = queries::project_sources(&library, &project).await.unwrap();
    assert_eq!(sources.len(), 2);

    // A third id merged into the by-hand entry lands on the preprint: no chain.
    let third = "c".repeat(64);
    queries::register_source(&library, &third, "/papers/pub.pdf", "pub.pdf")
        .await
        .unwrap();
    queries::alias_source(&library, &third, by_hand)
        .await
        .unwrap();
    assert_eq!(
        queries::canonical(&library, &third).await.unwrap(),
        preprint
    );

    // Merging the canonical into one of its own aliases re-points the rest.
    queries::alias_source(&library, &preprint, &third)
        .await
        .unwrap();
    for id in [&preprint, &by_hand.to_string()] {
        assert_eq!(queries::canonical(&library, id).await.unwrap(), third);
    }
    let chained: i64 = sqlx::query(
        "SELECT COUNT(*) AS n FROM source_aliases a JOIN source_aliases b ON a.canonical = b.alias",
    )
    .fetch_one(&library)
    .await
    .unwrap()
    .get("n");
    assert_eq!(chained, 0);

    // An id can't be made an alias of itself, and promoting back is the same
    // operation the other way round.
    assert!(queries::alias_source(&library, &third, &third)
        .await
        .is_err());
    queries::alias_source(&library, &third, &preprint)
        .await
        .unwrap();
    for id in [&third, &by_hand.to_string()] {
        assert_eq!(queries::canonical(&library, id).await.unwrap(), preprint);
    }
    assert_eq!(fk_violations(&library).await, 0);
}

/// ADR 003's "removing a source removes alias rows pointing at it", for free.
#[tokio::test]
async fn removing_a_work_takes_its_aliases_with_it() {
    let state = project("remove").await;
    let library = state.library().await.unwrap();

    let work = "erti:7f8e1c2a-0000-4000-8000-000000000003";
    queries::add_source_without_file(&library, work, BOOK, None, None)
        .await
        .unwrap();
    let file = "d".repeat(64);
    queries::register_source(&library, &file, "/papers/d.pdf", "d.pdf")
        .await
        .unwrap();
    queries::alias_source(&library, &file, work).await.unwrap();

    sqlx::query("DELETE FROM sources WHERE sha256 = ?")
        .bind(work)
        .execute(&library)
        .await
        .unwrap();
    let left: i64 = sqlx::query("SELECT COUNT(*) AS n FROM source_aliases")
        .fetch_one(&library)
        .await
        .unwrap()
        .get("n");
    assert_eq!(left, 0);
    // The file's own row survives, as its own work again.
    assert_eq!(queries::canonical(&library, &file).await.unwrap(), file);
    assert_eq!(fk_violations(&library).await, 0);
}
