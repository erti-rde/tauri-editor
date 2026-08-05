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

    // The next scan sees the file again and re-registers it. Registration reports
    // whether the *row* was new, which for a source that already failed is false —
    // so a caller that decides what to ingest from this return value skips it
    // forever, which is the original defect with a hash instead of a filename.
    // Ingest state is the authority; this asserts the two genuinely disagree, so
    // that anyone tempted to use the simpler signal sees why it is wrong.
    assert!(
        !queries::register_source(&library, "flaky1", "/a/f.pdf", "f.pdf")
            .await
            .unwrap(),
        "re-registering an existing source reports not-new"
    );
    assert_eq!(
        queries::sources_needing_ingest(&library).await.unwrap(),
        vec!["flaky1"],
        "yet it still needs ingesting"
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

// ---------------------------------------------------------------------------
// Salvage from the pre-hybrid database
// ---------------------------------------------------------------------------

/// Build a database shaped like the pre-hybrid one, with the same mix of good
/// rows, `'{}'` placeholders and registered-but-never-processed files that the
/// real one has.
async fn legacy_db_at(path: &Path) -> sqlx::SqlitePool {
    let pool = sqlx::SqlitePool::connect(&format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();

    sqlx::raw_sql(
        "CREATE TABLE files (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             file_name TEXT NOT NULL UNIQUE,
             created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
         );
         CREATE TABLE source_metadata (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             file_id INTEGER NULL UNIQUE,
             metadata TEXT NULL,
             created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
             updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
         );",
    )
    .execute(&pool)
    .await
    .unwrap();

    let rows: [(&str, Option<&str>); 5] = [
        (
            "resolved-a.pdf",
            Some(r#"{"title":"Postcolonial cities","type":"article-journal"}"#),
        ),
        (
            "resolved-b.pdf",
            Some(r#"{"title":"Cutting Feedback in Misspecified Copula Models"}"#),
        ),
        // The placeholder the old pipeline wrote whenever lookup failed.
        ("placeholder.pdf", Some("{}")),
        ("no-title.pdf", Some(r#"{"type":"article-journal"}"#)),
        // Registered, then never processed — 41% of the real corpus.
        ("never-processed.pdf", None),
    ];

    for (name, metadata) in rows {
        let id: i64 = sqlx::query_scalar("INSERT INTO files (file_name) VALUES (?) RETURNING id")
            .bind(name)
            .fetch_one(&pool)
            .await
            .unwrap();
        if let Some(json) = metadata {
            sqlx::query("INSERT INTO source_metadata (file_id, metadata) VALUES (?, ?)")
                .bind(id)
                .bind(json)
                .execute(&pool)
                .await
                .unwrap();
        }
    }

    pool
}

#[tokio::test]
async fn salvage_carries_forward_only_genuinely_resolved_metadata() {
    let dir = scratch("salvage");
    let (_state, library) = library_at(&dir).await;

    let legacy_path = dir.join("magnum_opus_test.db");
    legacy_db_at(&legacy_path).await.close().await;

    let report = erti_lib::db::salvage::import_legacy_metadata(&library, &legacy_path)
        .await
        .unwrap();

    assert_eq!(report.imported, 2, "only the rows with a real title");
    assert_eq!(
        report.already_present, 0,
        "nothing had been carried over yet"
    );
    assert_eq!(report.skipped_empty, 2, "'{{}}' and the title-less row");
    assert_eq!(
        report.skipped_unprocessed, 1,
        "the file that never processed"
    );

    // Every launch runs this. The insert is ON CONFLICT DO NOTHING, so the second
    // run writes nothing — and must not report that it imported anything, or the
    // user is told metadata was carried forward every time they open the app.
    let again = erti_lib::db::salvage::import_legacy_metadata(&library, &legacy_path)
        .await
        .unwrap();

    assert_eq!(again.imported, 0, "the second run creates no rows");
    assert_eq!(again.already_present, 2, "and says so separately");

    // Importing a '{}' placeholder would recreate the original problem: metadata
    // that looks resolved and is therefore never retried.
    assert!(
        erti_lib::db::salvage::legacy_metadata_for(&library, "placeholder.pdf")
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        erti_lib::db::salvage::legacy_metadata_for(&library, "resolved-a.pdf")
            .await
            .unwrap()
            .unwrap()
            .contains("Postcolonial cities")
    );
}

#[tokio::test]
async fn salvage_is_safe_to_run_more_than_once() {
    let dir = scratch("salvage-twice");
    let (_state, library) = library_at(&dir).await;

    let legacy_path = dir.join("old.db");
    legacy_db_at(&legacy_path).await.close().await;

    erti_lib::db::salvage::import_legacy_metadata(&library, &legacy_path)
        .await
        .unwrap();

    // A correction made after the first import must survive a second run.
    sqlx::query("UPDATE legacy_metadata SET csl_json = ? WHERE file_name = 'resolved-a.pdf'")
        .bind(r#"{"title":"Corrected by hand"}"#)
        .execute(&library)
        .await
        .unwrap();

    erti_lib::db::salvage::import_legacy_metadata(&library, &legacy_path)
        .await
        .unwrap();

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM legacy_metadata")
        .fetch_one(&library)
        .await
        .unwrap();
    assert_eq!(count, 2, "no duplicates on a second run");

    assert!(
        erti_lib::db::salvage::legacy_metadata_for(&library, "resolved-a.pdf")
            .await
            .unwrap()
            .unwrap()
            .contains("Corrected by hand"),
        "a later correction is not clobbered"
    );
}

#[tokio::test]
async fn a_missing_legacy_database_is_not_an_error() {
    // Most users are new and have nothing to migrate.
    let dir = scratch("salvage-absent");
    let (_state, library) = library_at(&dir).await;

    let report = erti_lib::db::salvage::import_legacy_metadata(&library, &dir.join("nope.db"))
        .await
        .unwrap();

    assert_eq!(report.imported, 0);
}

// ---------------------------------------------------------------------------
// End-to-end isolation, with real files on disk
// ---------------------------------------------------------------------------

/// Real PDFs from the benchmark corpus, if it has been fetched.
///
/// The earlier tests use synthetic hashes to exercise the schema; this one runs
/// actual bytes through actual hashing, which is where a filename-based identity
/// would still be able to hide.
fn corpus() -> Option<PathBuf> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()?
        .join("tests/fixtures/retrieval/papers");
    dir.exists().then_some(dir)
}

#[tokio::test]
async fn two_projects_stay_isolated_with_real_files_on_disk() {
    let Some(corpus) = corpus() else {
        eprintln!("skipping: run ./scripts/fetch-retrieval-corpus.sh for the PDF corpus");
        return;
    };

    let dir = scratch("e2e");
    let (state, library) = library_at(&dir).await;

    let thesis = dir.join("thesis");
    let review = dir.join("review");
    std::fs::create_dir_all(&thesis).unwrap();
    std::fs::create_dir_all(&review).unwrap();

    // Two *different* papers, both named paper.pdf — the case the old
    // `file_name UNIQUE` column silently dropped.
    std::fs::copy(corpus.join("1706.03762v7.pdf"), thesis.join("paper.pdf")).unwrap();
    std::fs::copy(corpus.join("1810.04805v2.pdf"), review.join("paper.pdf")).unwrap();

    // And one paper genuinely present in both folders.
    std::fs::copy(corpus.join("1512.03385v1.pdf"), thesis.join("shared.pdf")).unwrap();
    std::fs::copy(corpus.join("1512.03385v1.pdf"), review.join("shared.pdf")).unwrap();

    // --- open the first project and ingest its folder ----------------------
    state.open_project(&thesis).await.unwrap();
    let mut thesis_hashes = Vec::new();
    for name in ["paper.pdf", "shared.pdf"] {
        let path = thesis.join(name);
        let hash = erti_lib::db::hash_file(&path).await.unwrap();
        let is_new = queries::register_source(&library, &hash, path.to_str().unwrap(), name)
            .await
            .unwrap();
        assert!(is_new, "{name} is new to an empty library");
        queries::add_to_project(&state.project().await.unwrap(), &hash)
            .await
            .unwrap();
        store_one_chunk(&library, &hash).await;
        thesis_hashes.push(hash);
    }

    // --- open the second project and ingest its folder ---------------------
    state.open_project(&review).await.unwrap();
    let mut review_hashes = Vec::new();
    for name in ["paper.pdf", "shared.pdf"] {
        let path = review.join(name);
        let hash = erti_lib::db::hash_file(&path).await.unwrap();
        let is_new = queries::register_source(&library, &hash, path.to_str().unwrap(), name)
            .await
            .unwrap();

        if name == "shared.pdf" {
            assert!(
                !is_new,
                "the same paper is not re-ingested for a second project"
            );
        } else {
            assert!(is_new, "a different paper of the same name is still new");
        }

        queries::add_to_project(&state.project().await.unwrap(), &hash)
            .await
            .unwrap();
        if is_new {
            store_one_chunk(&library, &hash).await;
        }
        review_hashes.push(hash);
    }

    // Same name, different content: two distinct sources.
    assert_ne!(
        thesis_hashes[0], review_hashes[0],
        "same-named but different papers must not collide"
    );
    // Same content in two folders: one source.
    assert_eq!(
        thesis_hashes[1], review_hashes[1],
        "identical files share one identity"
    );

    // Three sources for four files, and the shared paper embedded once.
    let sources: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sources")
        .fetch_one(&library)
        .await
        .unwrap();
    assert_eq!(sources, 3, "four files, three distinct papers");

    let shared_chunks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM chunks WHERE sha256 = ?")
        .bind(&thesis_hashes[1])
        .fetch_one(&library)
        .await
        .unwrap();
    assert_eq!(
        shared_chunks, 1,
        "the shared paper is embedded once, not twice"
    );

    let shared_locations: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM locations WHERE sha256 = ?")
            .bind(&thesis_hashes[1])
            .fetch_one(&library)
            .await
            .unwrap();
    assert_eq!(shared_locations, 2, "but is known at both project paths");

    // --- each project sees only its own sources ----------------------------
    let review_sources = queries::project_sources(&library, &state.project().await.unwrap())
        .await
        .unwrap();
    let review_set: Vec<&str> = review_sources.iter().map(|s| s.sha256.as_str()).collect();
    assert_eq!(review_set.len(), 2);
    assert!(review_set.contains(&review_hashes[0].as_str()));
    assert!(
        !review_set.contains(&thesis_hashes[0].as_str()),
        "thesis's paper.pdf must not appear"
    );

    state.open_project(&thesis).await.unwrap();
    let thesis_sources = queries::project_sources(&library, &state.project().await.unwrap())
        .await
        .unwrap();
    let thesis_set: Vec<&str> = thesis_sources.iter().map(|s| s.sha256.as_str()).collect();
    assert_eq!(thesis_set.len(), 2);
    assert!(
        !thesis_set.contains(&review_hashes[0].as_str()),
        "review's paper.pdf must not appear"
    );
}

async fn store_one_chunk(library: &sqlx::SqlitePool, sha256: &str) {
    queries::store_chunks(
        library,
        sha256,
        &[queries::NewChunk {
            text: "text".into(),
            embedding: vec![0.5, 0.5],
            page_start: Some(1),
            page_end: Some(1),
            section: None,
            char_start: None,
            char_end: None,
        }],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn identical_bytes_hash_identically_and_a_single_byte_changes_it() {
    let dir = scratch("hashing");
    let a = dir.join("a.bin");
    let b = dir.join("b.bin");
    let c = dir.join("c.bin");

    // Larger than the 64KB read buffer, so the streaming path is exercised.
    let payload: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
    std::fs::write(&a, &payload).unwrap();
    std::fs::write(&b, &payload).unwrap();

    let mut altered = payload.clone();
    *altered.last_mut().unwrap() ^= 1;
    std::fs::write(&c, &altered).unwrap();

    let ha = erti_lib::db::hash_file(&a).await.unwrap();
    let hb = erti_lib::db::hash_file(&b).await.unwrap();
    let hc = erti_lib::db::hash_file(&c).await.unwrap();

    assert_eq!(ha, hb, "identical contents, identical identity");
    assert_ne!(ha, hc, "one differing byte is a different source");
    assert_eq!(ha.len(), 64, "hex-encoded SHA-256");
}
