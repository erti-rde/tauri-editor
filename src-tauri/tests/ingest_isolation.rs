//! #48 (M0-5): "If we are adding a new PDF file in the folder, Erti adds new
//! values for existing PDFs while processing the new one."
//!
//! Reported against the filename-keyed pipeline. Sources are now keyed by the
//! SHA-256 of their bytes, and every write names the source it is for. This
//! pins that down: ingesting a third paper leaves the first two byte-identical,
//! chunks, embeddings and metadata alike.

use erti_lib::db::{queries, DbState};
use sqlx::{Row, SqlitePool};
use std::path::PathBuf;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("erti-ingest-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn chunk(text: &str, seed: f32) -> queries::NewChunk {
    queries::NewChunk {
        text: text.to_string(),
        embedding: (0..384).map(|i| seed + i as f32 * 0.001).collect(),
        page_start: Some(1),
        page_end: Some(1),
        section: Some("Introduction".to_string()),
        char_start: Some(0),
        char_end: Some(text.len() as i64),
    }
}

/// Everything stored about one source, in a comparable form.
async fn snapshot(library: &SqlitePool, sha256: &str) -> (Vec<String>, Vec<String>) {
    let chunks = sqlx::query(
        "SELECT idx, text, page_start, page_end, section, char_start, char_end, embedding
           FROM chunks WHERE sha256 = ? ORDER BY idx",
    )
    .bind(sha256)
    .fetch_all(library)
    .await
    .unwrap()
    .iter()
    .map(|r| {
        format!(
            "{}|{}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}",
            r.get::<i64, _>("idx"),
            r.get::<String, _>("text"),
            r.get::<Option<i64>, _>("page_start"),
            r.get::<Option<i64>, _>("page_end"),
            r.get::<Option<String>, _>("section"),
            r.get::<Option<i64>, _>("char_start"),
            r.get::<Option<i64>, _>("char_end"),
            r.get::<Vec<u8>, _>("embedding"),
        )
    })
    .collect();

    let source = sqlx::query(
        "SELECT s.csl_json, s.zotero_type, s.doi, s.resolved_via, i.state
           FROM sources s JOIN ingest_status i USING (sha256) WHERE sha256 = ?",
    )
    .bind(sha256)
    .fetch_all(library)
    .await
    .unwrap()
    .iter()
    .map(|r| {
        format!(
            "{:?}|{:?}|{:?}|{:?}|{}",
            r.get::<Option<String>, _>("csl_json"),
            r.get::<Option<String>, _>("zotero_type"),
            r.get::<Option<String>, _>("doi"),
            r.get::<Option<String>, _>("resolved_via"),
            r.get::<String, _>("state"),
        )
    })
    .collect();

    (chunks, source)
}

async fn ingest(library: &SqlitePool, project: &SqlitePool, sha: &str, path: &str, title: &str) {
    let file_name = path.rsplit('/').next().unwrap();
    queries::register_source(library, sha, path, file_name)
        .await
        .unwrap();
    queries::set_source_metadata(
        library,
        sha,
        &format!(r#"{{"type":"article-journal","title":"{title}"}}"#),
        Some("journalArticle"),
        Some(&format!("10.1000/{sha}")),
        "pdf-doi",
    )
    .await
    .unwrap();
    queries::store_chunks(
        library,
        sha,
        &[
            chunk(&format!("{title}, first passage."), 0.1),
            chunk(&format!("{title}, second passage."), 0.2),
        ],
    )
    .await
    .unwrap();
    queries::add_to_project(project, sha).await.unwrap();
}

#[tokio::test]
async fn ingesting_a_new_paper_leaves_the_existing_ones_untouched() {
    let dir = scratch("isolation");
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await.unwrap();
    state.open_project(&dir.join("project")).await.unwrap();
    let library = state.library().await.unwrap();
    let project = state.project().await.unwrap();

    ingest(&library, &project, "sha-one", "/p/one.pdf", "One").await;
    ingest(&library, &project, "sha-two", "/p/two.pdf", "Two").await;
    let one_before = snapshot(&library, "sha-one").await;
    let two_before = snapshot(&library, "sha-two").await;
    assert_eq!(one_before.0.len(), 2);
    assert_eq!(one_before.1.len(), 1);

    // The re-scan that finds a third file registers the existing two again...
    assert!(
        !queries::register_source(&library, "sha-one", "/p/one.pdf", "one.pdf")
            .await
            .unwrap()
    );
    assert!(
        !queries::register_source(&library, "sha-two", "/p/two.pdf", "two.pdf")
            .await
            .unwrap()
    );
    // ...and ingests the new one.
    ingest(&library, &project, "sha-three", "/p/three.pdf", "Three").await;

    assert_eq!(snapshot(&library, "sha-one").await, one_before);
    assert_eq!(snapshot(&library, "sha-two").await, two_before);
    assert_eq!(snapshot(&library, "sha-three").await.0.len(), 2);

    let mut in_project = queries::project_source_hashes(&project).await.unwrap();
    in_project.sort();
    assert_eq!(in_project, ["sha-one", "sha-three", "sha-two"]);
}

#[tokio::test]
async fn the_same_paper_under_a_second_name_is_one_source() {
    let dir = scratch("duplicate");
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await.unwrap();
    state.open_project(&dir.join("project")).await.unwrap();
    let library = state.library().await.unwrap();
    let project = state.project().await.unwrap();

    ingest(&library, &project, "sha-one", "/p/one.pdf", "One").await;
    let before = snapshot(&library, "sha-one").await;

    // A copy with another file name has the same bytes, so the same hash.
    assert!(!queries::register_source(
        &library,
        "sha-one",
        "/p/copy-of-one.pdf",
        "copy-of-one.pdf"
    )
    .await
    .unwrap());

    assert_eq!(snapshot(&library, "sha-one").await, before);
    let sources: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sources")
        .fetch_one(&library)
        .await
        .unwrap();
    assert_eq!(sources, 1);
}
