//! Exercises the hybrid data model against real SQLite databases.
//!
//! The behaviours here are the ones the old single-database schema got wrong:
//! two projects could not hold same-named files, a shared PDF was ingested twice
//! under two ids, and a source that failed once was never retried.

use erti_lib::db::{queries, DbState};
use std::path::{Path, PathBuf};

/// Each test gets its own directory so they can run in parallel.
fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("erti-test-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

async fn library_at(dir: &Path) -> (DbState, sqlx::SqlitePool) {
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await.unwrap();
    let pool = state.library().await.unwrap();
    (state, pool)
}

#[tokio::test]
async fn the_same_filename_in_two_projects_does_not_collide() {
    // The old schema had `file_name TEXT NOT NULL UNIQUE`, so the second project's
    // paper.pdf failed to insert and was silently never processed.
    let dir = scratch("collision");
    let (state, library) = library_at(&dir).await;

    let project_a = dir.join("thesis");
    let project_b = dir.join("review");

    state.open_project(&project_a).await.unwrap();
    queries::register_source(&library, "aaa111", "/thesis/paper.pdf", "paper.pdf")
        .await
        .unwrap();
    queries::add_to_project(&state.project().await.unwrap(), "aaa111")
        .await
        .unwrap();

    state.open_project(&project_b).await.unwrap();
    queries::register_source(&library, "bbb222", "/review/paper.pdf", "paper.pdf")
        .await
        .unwrap();
    queries::add_to_project(&state.project().await.unwrap(), "bbb222")
        .await
        .unwrap();

    // Both files exist in the library despite sharing a name.
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sources")
        .fetch_one(&library)
        .await
        .unwrap();
    assert_eq!(count, 2, "both same-named files should be registered");

    // And the second project sees only its own.
    let sources = queries::project_sources(&library, &state.project().await.unwrap())
        .await
        .unwrap();
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].sha256, "bbb222");
}

#[tokio::test]
async fn a_pdf_shared_by_two_projects_is_stored_once() {
    // This is the reason for a shared library: reading a paper for one project
    // should make it citable from another without re-embedding it.
    let dir = scratch("shared");
    let (_state, library) = library_at(&dir).await;

    let first = queries::register_source(&library, "shared99", "/a/x.pdf", "x.pdf")
        .await
        .unwrap();
    assert!(first, "first registration is new");

    queries::store_chunks(
        &library,
        "shared99",
        &[queries::NewChunk {
            text: "a chunk".into(),
            embedding: vec![0.1, 0.2, 0.3],
            page_start: Some(1),
            page_end: Some(1),
            section: Some("Introduction".into()),
            char_start: None,
            char_end: None,
        }],
    )
    .await
    .unwrap();

    // Seen again at a second path, e.g. another project folder.
    let second = queries::register_source(&library, "shared99", "/b/x.pdf", "x.pdf")
        .await
        .unwrap();
    assert!(!second, "same content is not a new source");

    let sources: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sources")
        .fetch_one(&library)
        .await
        .unwrap();
    let chunks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM chunks WHERE sha256 = 'shared99'")
        .fetch_one(&library)
        .await
        .unwrap();
    let locations: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM locations WHERE sha256 = 'shared99'")
            .fetch_one(&library)
            .await
            .unwrap();

    assert_eq!(sources, 1, "one source for one hash");
    assert_eq!(chunks, 1, "embedded once, not twice");
    assert_eq!(locations, 2, "but known at both paths");
}

#[tokio::test]
async fn a_failed_source_is_offered_again() {
    // The old pipeline registered files before processing and deduplicated on the
    // filename, so a failure was permanent and invisible: 41% of the dev corpus.
    let dir = scratch("retry");
    let (_state, library) = library_at(&dir).await;

    queries::register_source(&library, "flaky1", "/a/f.pdf", "f.pdf")
        .await
        .unwrap();

    assert_eq!(
        queries::sources_needing_ingest(&library).await.unwrap(),
        vec!["flaky1"],
        "a new source is pending"
    );

    queries::mark_ingest_failed(&library, "flaky1", "network unreachable")
        .await
        .unwrap();

    assert_eq!(
        queries::sources_needing_ingest(&library).await.unwrap(),
        vec!["flaky1"],
        "a failed source is still offered"
    );

    queries::store_chunks(
        &library,
        "flaky1",
        &[queries::NewChunk {
            text: "recovered".into(),
            embedding: vec![1.0],
            page_start: None,
            page_end: None,
            section: None,
            char_start: None,
            char_end: None,
        }],
    )
    .await
    .unwrap();

    assert!(
        queries::sources_needing_ingest(&library)
            .await
            .unwrap()
            .is_empty(),
        "a ready source is not offered again"
    );
}

#[tokio::test]
async fn embeddings_survive_a_database_round_trip() {
    let dir = scratch("blob");
    let (_state, library) = library_at(&dir).await;

    let embedding: Vec<f32> = (0..384).map(|i| (i as f32) * 0.001 - 0.19).collect();
    queries::register_source(&library, "vec1", "/a/v.pdf", "v.pdf")
        .await
        .unwrap();
    queries::store_chunks(
        &library,
        "vec1",
        &[queries::NewChunk {
            text: "t".into(),
            embedding: embedding.clone(),
            page_start: None,
            page_end: None,
            section: None,
            char_start: None,
            char_end: None,
        }],
    )
    .await
    .unwrap();

    let stored: Vec<u8> = sqlx::query_scalar("SELECT embedding FROM chunks WHERE sha256 = 'vec1'")
        .fetch_one(&library)
        .await
        .unwrap();

    assert_eq!(stored.len(), 384 * 4, "packed f32, not JSON text");
    assert_eq!(erti_lib::db::unpack_embedding(&stored), embedding);
}

#[tokio::test]
async fn search_ranks_project_sources_above_the_wider_library() {
    // "Prioritising the PDFs by project": the project's own sources come first,
    // while the rest of the library stays visible and one click away.
    let dir = scratch("search");
    let (state, library) = library_at(&dir).await;
    state.open_project(&dir.join("proj")).await.unwrap();
    let project = state.project().await.unwrap();

    // The library source is a much closer match to the query than the project one.
    for (hash, embedding) in [
        ("inproj", vec![0.0f32, 1.0]),
        ("outside", vec![1.0f32, 0.0]),
    ] {
        queries::register_source(&library, hash, &format!("/{hash}.pdf"), "f.pdf")
            .await
            .unwrap();
        queries::store_chunks(
            &library,
            hash,
            &[queries::NewChunk {
                text: hash.into(),
                embedding,
                page_start: None,
                page_end: None,
                section: None,
                char_start: None,
                char_end: None,
            }],
        )
        .await
        .unwrap();
    }
    queries::add_to_project(&project, "inproj").await.unwrap();

    let hashes = queries::project_source_hashes(&project).await.unwrap();
    let query = vec![1.0f32, 0.0]; // identical to "outside"

    // Scoped to the project: the library source is not returned at all.
    let scoped = queries::search_similar(&library, &query, &hashes, 5, false)
        .await
        .unwrap();
    assert_eq!(scoped.len(), 1);
    assert_eq!(scoped[0].sha256, "inproj");

    // Widened: the better match appears, but ranked below the project's own.
    let widened = queries::search_similar(&library, &query, &hashes, 5, true)
        .await
        .unwrap();
    assert_eq!(widened.len(), 2);
    assert_eq!(widened[0].sha256, "inproj", "project sources rank first");
    assert!(widened[0].in_project);
    assert_eq!(widened[1].sha256, "outside");
    assert!(!widened[1].in_project);
}

#[tokio::test]
async fn project_overrides_shadow_library_metadata() {
    // Correcting a wrong author for one paper must not silently rewrite it for
    // every other project that cites the same source.
    let dir = scratch("override");
    let (state, library) = library_at(&dir).await;
    state.open_project(&dir.join("proj")).await.unwrap();
    let project = state.project().await.unwrap();

    queries::register_source(&library, "src1", "/a.pdf", "a.pdf")
        .await
        .unwrap();
    queries::set_source_metadata(
        &library,
        "src1",
        r#"{"title":"Library title"}"#,
        Some("journalArticle"),
        Some("10.1000/x"),
        "crossref",
    )
    .await
    .unwrap();
    queries::add_to_project(&project, "src1").await.unwrap();

    let before = queries::project_sources(&library, &project).await.unwrap();
    assert!(before[0]
        .csl_json
        .as_ref()
        .unwrap()
        .contains("Library title"));

    queries::set_metadata_override(&project, "src1", r#"{"title":"Corrected locally"}"#)
        .await
        .unwrap();

    let after = queries::project_sources(&library, &project).await.unwrap();
    assert!(after[0]
        .csl_json
        .as_ref()
        .unwrap()
        .contains("Corrected locally"));

    // The library's own copy is untouched.
    let library_copy: Option<String> =
        sqlx::query_scalar("SELECT csl_json FROM sources WHERE sha256 = 'src1'")
            .fetch_one(&library)
            .await
            .unwrap();
    assert!(library_copy.unwrap().contains("Library title"));
}

#[tokio::test]
async fn reopening_a_project_keeps_its_source_set() {
    let dir = scratch("persist");
    let (state, library) = library_at(&dir).await;
    let root = dir.join("proj");

    state.open_project(&root).await.unwrap();
    queries::register_source(&library, "keep1", "/k.pdf", "k.pdf")
        .await
        .unwrap();
    queries::add_to_project(&state.project().await.unwrap(), "keep1")
        .await
        .unwrap();

    // Simulate closing and reopening the app.
    let reopened = DbState::default();
    reopened
        .open_library(&dir.join("library.db"))
        .await
        .unwrap();
    reopened.open_project(&root).await.unwrap();

    assert_eq!(
        queries::project_source_hashes(&reopened.project().await.unwrap())
            .await
            .unwrap(),
        vec!["keep1"]
    );
    assert!(root.join(".erti").join("project.db").exists());
}
