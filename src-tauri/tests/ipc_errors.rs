//! Errors keep their kind all the way through a command (M1a-10 AC-5).
//!
//! The first version relabelled a missing file as a database error on its way
//! out of `hash_file`: every unit was right, and the path through the command
//! was wrong. Only a probe in the running app caught it, so these go through
//! the commands themselves.

use erti_lib::db::DbState;
use erti_lib::db_commands::hash_file;
use erti_lib::ipc::ErrorKind;

#[tokio::test]
async fn a_missing_file_is_not_found_through_the_command() {
    let err = hash_file("/definitely/not/here.pdf".into())
        .await
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::NotFound);
    assert!(err.message.contains("no longer exists"));
}

#[tokio::test]
async fn nothing_open_yet_is_a_conflict_not_a_database_failure() {
    let state = DbState::default();
    assert_eq!(state.library().await.unwrap_err().kind, ErrorKind::Conflict);
    assert_eq!(state.project().await.unwrap_err().kind, ErrorKind::Conflict);
}
