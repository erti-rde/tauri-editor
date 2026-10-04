//! One canonical id per work, at every boundary (M1b-3, ADR 003).
//!
//! A work is cited, kept in a project and read for metadata by one id; a PDF
//! attached to it, or a duplicate merged into it, is an alias. These check the
//! resolver against the fixture the TS suite also reads, the one write that
//! makes aliases, and the queries that resolve: search, `source_set`
//! membership, overrides and the Notes panel's marks.

use erti_lib::db::{queries, DbState};
use erti_lib::db_commands::source_aliases_in;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Deserialize)]
struct Fixture {
    sources: Vec<String>,
    aliases: HashMap<String, String>,
    resolve: Vec<Resolve>,
    sets: Vec<Set>,
    writes: Vec<Write>,
}

#[derive(Deserialize)]
struct Resolve {
    why: String,
    id: String,
    canonical: String,
}

#[derive(Deserialize)]
struct Set {
    why: String,
    ids: Vec<String>,
    canonical: Vec<String>,
}

#[derive(Deserialize)]
struct Write {
    why: String,
    alias: String,
    canonical: String,
    #[serde(default)]
    rejected: bool,
    aliases: Option<HashMap<String, String>>,
}

fn fixture() -> Fixture {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../tests/fixtures/aliases.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("erti-canonical-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A library and an open project, through the same opening the app does.
async fn opened(name: &str) -> DbState {
    let dir = scratch(name);
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await.unwrap();
    state.open_project(&dir.join("project")).await.unwrap();
    state
}

/// The fixture's sources and aliases, written as rows. The aliases go in
/// directly: they are the state under test, not the write.
async fn seeded(name: &str) -> (DbState, sqlx::SqlitePool, Fixture) {
    let state = opened(name).await;
    let library = state.library().await.unwrap();
    let fixture = fixture();
    for id in &fixture.sources {
        queries::add_source_without_file(
            &library,
            id,
            r#"{"type":"book","title":"T"}"#,
            None,
            None,
        )
        .await
        .unwrap();
    }
    for (alias, canonical) in &fixture.aliases {
        sqlx::query("INSERT INTO source_aliases (alias, canonical) VALUES (?, ?)")
            .bind(alias)
            .bind(canonical)
            .execute(&library)
            .await
            .unwrap();
    }
    (state, library, fixture)
}

/// No alias is the canonical id of another: what "no chains" means.
async fn assert_no_chains(library: &sqlx::SqlitePool, why: &str) {
    let chained: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM source_aliases a JOIN source_aliases b ON b.alias = a.canonical",
    )
    .fetch_one(library)
    .await
    .unwrap();
    assert_eq!(chained, 0, "{why}: the table has a chain");
}

// M1b-3 AC-2
#[tokio::test]
async fn the_shared_fixture_resolves_the_same_in_rust() {
    let (state, library, fixture) = seeded("fixture").await;

    // The map the webview is given holds exactly the fixture's aliases.
    let served = source_aliases_in(&state).await.unwrap();
    assert_eq!(served, fixture.aliases);

    for case in &fixture.resolve {
        assert_eq!(
            queries::resolve(&served, &case.id),
            case.canonical,
            "{}",
            case.why
        );
        assert_eq!(
            queries::canonical(&library, &case.id).await.unwrap(),
            case.canonical,
            "{} (one id, against the library)",
            case.why
        );
    }

    for case in &fixture.sets {
        assert_eq!(
            queries::resolve_all(&served, &case.ids),
            case.canonical,
            "{}",
            case.why
        );
    }
}

// M1b-3 AC-3
#[tokio::test]
async fn alias_chains_are_rejected_on_write() {
    for (i, case) in fixture().writes.iter().enumerate() {
        let (_state, library, _) = seeded(&format!("write-{i}")).await;
        let before = queries::alias_map(&library).await.unwrap();

        let written = queries::alias_source(&library, &case.alias, &case.canonical).await;
        let after = queries::alias_map(&library).await.unwrap();

        if case.rejected {
            assert!(written.is_err(), "{}: should be refused", case.why);
            assert_eq!(after, before, "{}: a refusal changes nothing", case.why);
        } else {
            written.unwrap_or_else(|e| panic!("{}: {e}", case.why));
            assert_eq!(&after, case.aliases.as_ref().unwrap(), "{}", case.why);
        }
        assert_no_chains(&library, &case.why).await;
    }
}

// M1b-3 AC-1: notes. Source notes are kept on the canonical id (ADR 004), so
// the one write that changes which id that is moves them too.
#[tokio::test]
async fn a_merged_work_takes_its_source_notes_to_the_work_it_joins() {
    let (_state, library, _) = seeded("notes").await;
    let book = "erti:6f1c3a52-8d0e-4c1b-9a7e-2b5d4f3e1a01";
    let paper = "b1".repeat(32);
    sqlx::query("INSERT INTO source_notes (id, sha256, body) VALUES ('n1', ?, 'argues X')")
        .bind(book)
        .execute(&library)
        .await
        .unwrap();

    queries::alias_source(&library, book, &paper).await.unwrap();

    let on: String = sqlx::query_scalar("SELECT sha256 FROM source_notes WHERE id = 'n1'")
        .fetch_one(&library)
        .await
        .unwrap();
    assert_eq!(
        on, paper,
        "the note follows the work, not the id it was made on"
    );
}

fn chunk(text: &str, embedding: Vec<f32>) -> queries::NewChunk {
    queries::NewChunk {
        text: text.into(),
        embedding,
        page_start: Some(4),
        page_end: None,
        section: None,
        char_start: None,
        char_end: None,
    }
}

/// A book cited with no file, then a PDF of it found by a folder scan and
/// attached: the case every boundary below has to get right.
async fn attached(name: &str) -> (DbState, sqlx::SqlitePool, sqlx::SqlitePool) {
    let state = opened(name).await;
    let library = state.library().await.unwrap();
    let project = state.project().await.unwrap();

    queries::add_source_without_file(
        &library,
        "erti:book",
        r#"{"type":"book","title":"Book"}"#,
        None,
        None,
    )
    .await
    .unwrap();
    queries::add_to_project(&project, "erti:book")
        .await
        .unwrap();

    queries::register_source(&library, "pdf", "/papers/book.pdf", "book.pdf")
        .await
        .unwrap();
    queries::store_chunks(&library, "pdf", &[chunk("a passage", vec![1.0, 0.0])])
        .await
        .unwrap();
    // The scan adds the file's own hash to the project, as it does today.
    queries::add_to_project(&project, "pdf").await.unwrap();

    queries::alias_source(&library, "pdf", "erti:book")
        .await
        .unwrap();
    (state, library, project)
}

// M1b-3 AC-1: search results
#[tokio::test]
async fn a_search_result_carries_the_work_to_cite_and_the_file_to_open() {
    let (_state, library, project) = attached("search").await;
    // The project names only the work: the PDF's passages are still its own.
    sqlx::query("DELETE FROM source_set WHERE sha256 = 'pdf'")
        .execute(&project)
        .await
        .unwrap();
    let hashes = queries::project_source_hashes(&project).await.unwrap();

    let found = queries::search_similar(&library, &[1.0, 0.0], &hashes, 5, false)
        .await
        .unwrap();
    assert_eq!(found.len(), 1, "in the project by its work");
    assert_eq!(found[0].source_id, "erti:book");
    assert_eq!(found[0].sha256, "pdf", "Show in PDF opens the file");
    assert!(found[0].in_project);
}

// M1b-3 AC-1: source_set membership
#[tokio::test]
async fn a_project_lists_a_work_once_whichever_ids_name_it() {
    let (_state, library, project) = attached("membership").await;

    let sources = queries::project_sources(&library, &project).await.unwrap();
    assert_eq!(sources.len(), 1, "the work and its PDF are one source");
    assert_eq!(sources[0].sha256, "erti:book");
    assert_eq!(sources[0].state, "ready", "citable from the work's own row");
    assert_eq!(
        sources[0].path.as_deref(),
        Some("/papers/book.pdf"),
        "Open PDF on the work finds its attached file"
    );
    assert_eq!(sources[0].file_name, "book.pdf");
    assert_eq!(
        sources[0].file_sha256.as_deref(),
        Some("pdf"),
        "a retry ingests the file under its own hash, not the work's"
    );

    // A project that names only the PDF still lists the work, by its own id.
    sqlx::query("DELETE FROM source_set WHERE sha256 = 'erti:book'")
        .execute(&project)
        .await
        .unwrap();
    let sources = queries::project_sources(&library, &project).await.unwrap();
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].sha256, "erti:book");
}

// M1b-3 AC-1: source_set membership, for a project-local correction
#[tokio::test]
async fn an_override_on_a_merged_id_still_corrects_the_work() {
    let (_state, library, project) = attached("override").await;

    queries::set_metadata_override(&project, "pdf", r#"{"title":"Made on the PDF"}"#)
        .await
        .unwrap();
    let sources = queries::project_sources(&library, &project).await.unwrap();
    assert_eq!(
        sources[0].csl_json.as_deref(),
        Some(r#"{"title":"Made on the PDF"}"#)
    );

    // The work's own override wins over one made on an alias.
    queries::set_metadata_override(&project, "erti:book", r#"{"title":"Made on the work"}"#)
        .await
        .unwrap();
    let sources = queries::project_sources(&library, &project).await.unwrap();
    assert_eq!(
        sources[0].csl_json.as_deref(),
        Some(r#"{"title":"Made on the work"}"#)
    );
}

// M1b-3 AC-1: source_set membership, when two merged ids were corrected in
// the same second
#[tokio::test]
async fn two_merged_overrides_of_one_age_settle_the_same_way_every_time() {
    let (_state, library, project) = attached("override-tie").await;
    queries::register_source(&library, "another", "/papers/again.pdf", "again.pdf")
        .await
        .unwrap();
    queries::alias_source(&library, "another", "erti:book")
        .await
        .unwrap();

    // The timestamp is to the second; inserted in both orders, the same id wins.
    for order in [["pdf", "another"], ["another", "pdf"]] {
        sqlx::query("DELETE FROM metadata_overrides")
            .execute(&project)
            .await
            .unwrap();
        for id in order {
            sqlx::query(
                "INSERT INTO metadata_overrides (sha256, csl_json, updated_at)
                 VALUES (?, ?, '2026-10-04 12:00:00')",
            )
            .bind(id)
            .bind(format!(r#"{{"title":"Made on {id}"}}"#))
            .execute(&project)
            .await
            .unwrap();
        }
        let sources = queries::project_sources(&library, &project).await.unwrap();
        assert_eq!(
            sources[0].csl_json.as_deref(),
            Some(r#"{"title":"Made on another"}"#),
            "inserted as {order:?}"
        );
    }
}

// M1b-3 AC-1: notes (the marks the Notes panel searches, and cites from)
#[tokio::test]
async fn a_highlight_on_an_attached_pdf_cites_the_work() {
    let (_state, library, project) = attached("marks").await;
    queries::save_annotation(
        &library,
        &queries::NewAnnotation {
            id: "m1".into(),
            sha256: "pdf".into(),
            kind: "highlight".into(),
            label_id: None,
            page: 4,
            rects: None,
            quote: Some("the strongest effect".into()),
            prefix: None,
            suffix: None,
            char_start: None,
            char_end: None,
            note: None,
            style: None,
            page_label: None,
            origin: None,
        },
    )
    .await
    .unwrap();
    queries::save_annotation_embedding(&library, "m1", &[1.0, 0.0], "h")
        .await
        .unwrap();
    sqlx::query("DELETE FROM source_set WHERE sha256 = 'pdf'")
        .execute(&project)
        .await
        .unwrap();
    let hashes = queries::project_source_hashes(&project).await.unwrap();

    let literal = queries::search_annotations_literally(&library, "strongest", &hashes, 10)
        .await
        .unwrap();
    let semantic = queries::search_annotations_semantically(&library, &[1.0, 0.0], &hashes, 10)
        .await
        .unwrap();
    for (how, found) in [("literally", literal), ("by meaning", semantic)] {
        assert_eq!(found.len(), 1, "{how}");
        assert_eq!(found[0].source_id, "erti:book", "{how}: cites the work");
        assert_eq!(found[0].annotation.sha256, "pdf", "{how}: shows the file");
        assert!(found[0].in_project, "{how}: in the project by its work");
    }
}

// M1b-3 AC-1, and ADR 003 on removal: the alias goes with the work, and the
// PDF the project also named is a work of its own again.
#[tokio::test]
async fn removing_the_work_leaves_its_pdf_in_the_project() {
    let (_state, library, project) = attached("removed").await;
    sqlx::query("DELETE FROM sources WHERE sha256 = 'erti:book'")
        .execute(&library)
        .await
        .unwrap();

    let sources = queries::project_sources(&library, &project).await.unwrap();
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].sha256, "pdf");
    assert_eq!(sources[0].file_sha256.as_deref(), Some("pdf"));
    assert!(queries::alias_map(&library).await.unwrap().is_empty());
}
