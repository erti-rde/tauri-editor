//! "Add to library" for a source a manuscript carries (M1a-8 AC-6, UX-12).

use erti_lib::db::{queries, DbState};
use erti_lib::db_commands::add_source_from_manuscript_in;
use erti_lib::ipc::ErrorKind;
use std::path::PathBuf;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("erti-carried-{name}-{}", std::process::id()));
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

const BOOK: &str = r#"{"id":"abc","type":"book","title":"A book I don't have","DOI":"10.1/x","zotero_type":"book"}"#;

#[tokio::test]
async fn a_carried_source_joins_the_library_and_the_project_with_no_file() {
    let state = project("adds").await;

    assert!(
        add_source_from_manuscript_in(&state, "abc".into(), BOOK.into())
            .await
            .unwrap()
    );

    let library = state.library().await.unwrap();
    let project = state.project().await.unwrap();
    let sources = queries::project_sources(&library, &project).await.unwrap();
    let added = sources.iter().find(|s| s.sha256 == "abc").unwrap();

    // Citable at once, never offered for ingest, and no file to open.
    assert_eq!(added.state, "ready");
    assert_eq!(added.csl_json.as_deref(), Some(BOOK));
    assert_eq!(added.doi.as_deref(), Some("10.1/x"));
    assert_eq!(added.zotero_type.as_deref(), Some("book"));
    assert_eq!(added.resolved_via.as_deref(), Some("manuscript"));
    assert_eq!(added.path, None);
    assert!(!queries::sources_needing_ingest(&library)
        .await
        .unwrap()
        .contains(&"abc".to_string()));
}

#[tokio::test]
async fn a_source_the_library_has_is_left_as_it_is() {
    let state = project("keeps").await;
    let library = state.library().await.unwrap();
    queries::register_source(&library, "abc", "/papers/a.pdf", "a.pdf")
        .await
        .unwrap();
    queries::set_source_metadata(
        &library,
        "abc",
        r#"{"title":"Mine"}"#,
        None,
        None,
        "pdf-doi",
    )
    .await
    .unwrap();

    assert!(
        !add_source_from_manuscript_in(&state, "abc".into(), BOOK.into())
            .await
            .unwrap()
    );

    let project = state.project().await.unwrap();
    let sources = queries::project_sources(&library, &project).await.unwrap();
    let kept = sources.iter().find(|s| s.sha256 == "abc").unwrap();
    assert_eq!(kept.csl_json.as_deref(), Some(r#"{"title":"Mine"}"#));
    assert_eq!(kept.resolved_via.as_deref(), Some("pdf-doi"));
}

#[tokio::test]
async fn a_malformed_request_is_refused() {
    let state = project("refuses").await;
    for (id, csl) in [
        ("", BOOK),
        ("a\u{0}b", BOOK),
        ("abc", "not json"),
        ("abc", "[1, 2]"),
    ] {
        let err = add_source_from_manuscript_in(&state, id.into(), csl.into())
            .await
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidInput, "{id:?} {csl:?}");
    }
    let long = "x".repeat(201);
    assert!(add_source_from_manuscript_in(&state, long, BOOK.into())
        .await
        .is_err());
}
