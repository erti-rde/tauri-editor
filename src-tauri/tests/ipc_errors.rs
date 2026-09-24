//! Errors keep their kind all the way through a command (M1a-10 AC-5).
//!
//! The first version relabelled a missing file as a database error on its way
//! out of `hash_file`: every unit was right, and the path through the command
//! was wrong. Only a probe in the running app caught it, so these go through
//! the commands themselves.

use erti_lib::db::DbState;
use erti_lib::db_commands::hash_file_in;
use erti_lib::ipc::ErrorKind;

#[tokio::test]
async fn a_missing_file_is_not_found_through_the_command() {
    // Inside a folder the user picked: outside one, a missing file is refused
    // like any other (M1a-3), without saying whether it exists.
    let dir = std::env::temp_dir().join(format!("erti-ipc-errors-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let state = DbState::default();
    state.grants.grant(&dir);

    let missing = dir.join("not-here.pdf").to_string_lossy().to_string();
    let err = hash_file_in(&state, missing).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::NotFound);
    assert!(err.message.contains("no longer exists"));
}

#[tokio::test]
async fn nothing_open_yet_is_a_conflict_not_a_database_failure() {
    let state = DbState::default();
    assert_eq!(state.library().await.unwrap_err().kind, ErrorKind::Conflict);
    assert_eq!(state.project().await.unwrap_err().kind, ErrorKind::Conflict);
}
