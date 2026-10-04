//! A source entered by hand (M1b-5, docs/ux.md UX-2): a work with no file,
//! in the library and the open project.

use erti_lib::db::{queries, DbState};
use erti_lib::db_commands::add_source_by_hand_in;
use erti_lib::ipc::ErrorKind;
use sqlx::Row;

const ID: &str = "erti:6f1c3a52-8d0e-4c1b-9a7e-2b5d4f3e1a01";
const BOOK: &str = r#"{"type":"book","title":"Orality and Literacy","author":[{"family":"Ong","given":"Walter J."}]}"#;

async fn opened(name: &str) -> DbState {
    let dir = std::env::temp_dir().join(format!("erti-by-hand-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await.unwrap();
    state.open_project(&dir.join("project")).await.unwrap();
    state
}

// M1b-5 AC-2
#[tokio::test]
async fn saving_adds_a_no_file_source_to_the_library_and_the_project() {
    let state = opened("saves").await;

    add_source_by_hand_in(&state, ID.into(), BOOK.into(), "book".into())
        .await
        .unwrap();

    let library = state.library().await.unwrap();
    let row =
        sqlx::query("SELECT csl_json, zotero_type, resolved_via FROM sources WHERE sha256 = ?")
            .bind(ID)
            .fetch_one(&library)
            .await
            .unwrap();
    assert_eq!(row.get::<String, _>("csl_json"), BOOK);
    assert_eq!(row.get::<String, _>("zotero_type"), "book");
    assert_eq!(row.get::<String, _>("resolved_via"), "by-hand");

    let project = state.project().await.unwrap();
    let listed = queries::project_sources(&library, &project).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].sha256, ID);
    assert_eq!(
        listed[0].state, "ready",
        "nothing to ingest, so it's ready to cite"
    );
    assert_eq!(listed[0].path, None, "no file");
}

// M1b-5 AC-2
#[tokio::test]
async fn an_id_a_file_s_hash_could_be_is_refused() {
    let state = opened("ids").await;
    for id in [
        "a".repeat(64),
        "erti:not-a-uuid".into(),
        ID.replace("erti:", ""),
    ] {
        let err = add_source_by_hand_in(&state, id, BOOK.into(), "book".into())
            .await
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidInput);
    }
}

#[tokio::test]
async fn a_source_needs_a_title_and_a_kind() {
    let state = opened("title").await;

    let untitled = add_source_by_hand_in(
        &state,
        ID.into(),
        r#"{"type":"book","title":"  "}"#.into(),
        "book".into(),
    )
    .await
    .unwrap_err();
    assert_eq!(untitled.message, "Give the source a title.");

    let untyped = add_source_by_hand_in(&state, ID.into(), BOOK.into(), String::new())
        .await
        .unwrap_err();
    assert_eq!(untyped.kind, ErrorKind::InvalidInput);

    // Nothing for citeproc to format it by.
    let no_csl_type =
        add_source_by_hand_in(&state, ID.into(), r#"{"title":"X"}"#.into(), "book".into())
            .await
            .unwrap_err();
    assert_eq!(no_csl_type.kind, ErrorKind::InvalidInput);
}

#[tokio::test]
async fn a_source_the_project_could_not_take_is_not_left_in_the_library() {
    let state = opened("half").await;
    state.project().await.unwrap().close().await;

    add_source_by_hand_in(&state, ID.into(), BOOK.into(), "book".into())
        .await
        .unwrap_err();

    let library = state.library().await.unwrap();
    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sources WHERE sha256 = ?")
        .bind(ID)
        .fetch_one(&library)
        .await
        .unwrap();
    assert_eq!(left, 0, "no copy in no project for the next try to add to");
}

#[tokio::test]
async fn the_same_id_twice_is_a_conflict_not_a_quiet_overwrite() {
    let state = opened("twice").await;
    add_source_by_hand_in(&state, ID.into(), BOOK.into(), "book".into())
        .await
        .unwrap();

    let again = add_source_by_hand_in(
        &state,
        ID.into(),
        r#"{"type":"book","title":"Something else"}"#.into(),
        "book".into(),
    )
    .await
    .unwrap_err();
    assert_eq!(again.kind, ErrorKind::Conflict);
}
