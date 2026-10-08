//! Importing a bibliography (M1b-9, docs/ux.md UX-6): works with no file,
//! added in batches, and the library listed to match them against first.

use erti_lib::db::{queries, DbState};
use erti_lib::db_commands::{
    add_source_by_hand_in, import_sources_in, ImportedSource, IMPORT_BATCH,
};
use erti_lib::ipc::ErrorKind;
use sqlx::Row;

async fn opened(name: &str) -> DbState {
    let dir = std::env::temp_dir().join(format!("erti-import-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await.unwrap();
    state.open_project(&dir.join("project")).await.unwrap();
    state
}

fn id(n: usize) -> String {
    format!("erti:00000000-0000-4000-8000-{n:012x}")
}

fn source(n: usize, doi: Option<&str>) -> ImportedSource {
    let mut csl = serde_json::json!({ "type": "article-journal", "title": format!("Paper {n}") });
    if let Some(doi) = doi {
        csl["DOI"] = doi.into();
    }
    ImportedSource {
        id: id(n),
        csl_json: csl.to_string(),
        zotero_type: "journalArticle".into(),
    }
}

async fn in_project(state: &DbState) -> Vec<String> {
    let project = state.project().await.unwrap();
    queries::project_source_hashes(&project).await.unwrap()
}

// M1b-9 AC-6
#[tokio::test]
async fn an_import_adds_works_with_no_file_to_the_library() {
    let state = opened("adds").await;

    let batch = import_sources_in(
        &state,
        vec![
            source(1, Some("https://doi.org/10.5555/ONE")),
            source(2, None),
        ],
        false,
    )
    .await
    .unwrap();

    assert_eq!(batch.added, vec![id(1), id(2)]);
    assert!(batch.skipped.is_empty());
    let library = state.library().await.unwrap();
    let row = sqlx::query(
        "SELECT s.doi, s.resolved_via, s.zotero_type, i.state
           FROM sources s JOIN ingest_status i USING (sha256) WHERE sha256 = ?",
    )
    .bind(id(1))
    .fetch_one(&library)
    .await
    .unwrap();
    assert_eq!(
        row.get::<String, _>("doi"),
        "10.5555/one",
        "stored as compared"
    );
    assert_eq!(row.get::<String, _>("resolved_via"), "import");
    assert_eq!(row.get::<String, _>("zotero_type"), "journalArticle");
    assert_eq!(row.get::<String, _>("state"), "ready", "nothing to read");
    assert!(
        in_project(&state).await.is_empty(),
        "the project only when asked"
    );
}

// M1b-9 AC-6
#[tokio::test]
async fn asked_to_it_adds_them_to_the_project_too() {
    let state = opened("project").await;

    import_sources_in(&state, vec![source(1, None), source(2, None)], true)
        .await
        .unwrap();

    assert_eq!(in_project(&state).await, vec![id(1), id(2)]);
}

// M1b-9 AC-4
#[tokio::test]
async fn a_doi_the_library_gained_since_the_preview_is_skipped() {
    let state = opened("doi").await;
    add_source_by_hand_in(
        &state,
        id(9),
        r#"{"type":"book","title":"Already","DOI":"10.5555/one"}"#.into(),
        "book".into(),
    )
    .await
    .unwrap();

    let batch = import_sources_in(
        &state,
        vec![
            source(1, Some("doi:10.5555/ONE")),
            source(2, Some("10.5555/two")),
            // Twice in one batch: the second is the first.
            source(3, Some("https://dx.doi.org/10.5555/two")),
        ],
        true,
    )
    .await
    .unwrap();

    assert_eq!(batch.added, vec![id(2)]);
    assert_eq!(batch.skipped, vec![id(1), id(3)]);
    assert!(!in_project(&state).await.contains(&id(1)));
}

// M1b-9 AC-6
#[tokio::test]
async fn a_batch_with_one_bad_source_writes_nothing() {
    let state = opened("bad").await;
    let mut untitled = source(2, None);
    untitled.csl_json = r#"{"type":"book","title":" "}"#.into();
    let mut hashed = source(3, None);
    hashed.id = "a".repeat(64);

    for bad in [untitled, hashed] {
        let err = import_sources_in(&state, vec![source(1, None), bad], true)
            .await
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidInput);
    }
    let library = state.library().await.unwrap();
    assert!(queries::library_works(&library).await.unwrap().is_empty());
}

// M1b-9 AC-6
#[tokio::test]
async fn a_batch_has_a_limit() {
    let state = opened("most").await;
    let many = (0..=IMPORT_BATCH).map(|n| source(n, None)).collect();

    let err = import_sources_in(&state, many, false).await.unwrap_err();

    assert_eq!(err.kind, ErrorKind::InvalidInput);
}

// M1b-9 AC-4
#[tokio::test]
async fn the_library_is_listed_by_work_with_its_details() {
    let state = opened("works").await;
    import_sources_in(&state, vec![source(1, Some("10.5555/One"))], false)
        .await
        .unwrap();
    let library = state.library().await.unwrap();
    // A PDF attached to the work lists as the work.
    sqlx::query(
        "INSERT INTO sources (sha256, csl_json) VALUES ('f00d', '{\"title\":\"Its PDF\"}')",
    )
    .execute(&library)
    .await
    .unwrap();
    sqlx::query("INSERT INTO source_aliases (alias, canonical) VALUES ('f00d', ?)")
        .bind(id(1))
        .execute(&library)
        .await
        .unwrap();

    let works = queries::library_works(&library).await.unwrap();

    assert_eq!(works.len(), 2);
    assert!(works.iter().all(|w| w.id == id(1)));
    assert_eq!(works[0].doi.as_deref(), Some("10.5555/one"));
    assert!(works[0].csl_json.as_deref().unwrap().contains("Paper 1"));
}

// M1b-9 AC-6
#[tokio::test]
async fn ten_thousand_import_in_batches_well_inside_the_budget() {
    let state = opened("ten-thousand").await;
    let started = std::time::Instant::now();
    for start in (0..10_000).step_by(IMPORT_BATCH) {
        let batch = (start..start + IMPORT_BATCH)
            .map(|n| source(n, Some(&format!("10.5555/{n}"))))
            .collect();
        import_sources_in(&state, batch, true).await.unwrap();
    }
    let took = started.elapsed();

    assert_eq!(in_project(&state).await.len(), 10_000);
    // The whole import has 30 s; writing is the part of it measured here.
    assert!(took.as_secs() < 15, "took {took:?}");
}
