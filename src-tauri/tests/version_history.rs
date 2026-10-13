//! Version history through the commands (M5-1, ADR 007).
//!
//! The rules themselves (names, the ten-minute rule, thinning) are tabled in
//! `history.rs`. These go through what the webview calls: which paths are a
//! manuscript of the open project, and that opening a project thins.

use erti_lib::db::DbState;
use erti_lib::db_commands::open_project_in;
use erti_lib::history::{
    clear_snapshots_in, name_for, read_snapshot_in, restore_snapshot_in, snapshot_history_in,
    take_snapshot_in, time_of_name, Trigger,
};
use erti_lib::ipc::ErrorKind;
use std::path::PathBuf;

const DAY: i64 = 24 * 60 * 60;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "erti-version-history-{name}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::canonicalize(dir).unwrap()
}

/// A project the user picked, open.
async fn project(name: &str) -> (DbState, PathBuf) {
    let root = scratch(name);
    let state = DbState::default();
    state.grants.grant(&root);
    open_project_in(&state, root.to_string_lossy().into())
        .await
        .unwrap();
    (state, root)
}

fn at(stamp: &str) -> i64 {
    time_of_name(&format!("{stamp}.erti.json")).unwrap()
}

// M5-1 AC-1, AC-2, AC-4
#[tokio::test]
async fn snapshots_are_manuscripts_under_the_project_history() {
    let (state, root) = project("take").await;
    let doc = root.join("Chapter 1.erti.json");
    let path = doc.to_string_lossy().to_string();
    let t = at("2026-10-12T16-00-00Z");

    std::fs::write(&doc, r#"{"type":"doc","content":[],"erti":{"format":1}}"#).unwrap();
    let taken = take_snapshot_in(&state, path.clone(), Trigger::Close, Some(0), t)
        .await
        .unwrap()
        .unwrap();
    let file = root
        .join(".erti")
        .join("history")
        .join("Chapter 1")
        .join("2026-10-12T16-00-00Z.erti.json");
    assert_eq!(taken.file, "2026-10-12T16-00-00Z.erti.json");
    assert_eq!(
        std::fs::read_to_string(&file).unwrap(),
        std::fs::read_to_string(&doc).unwrap()
    );
    assert_eq!(
        read_snapshot_in(&state, path.clone(), taken.file.clone())
            .await
            .unwrap(),
        std::fs::read_to_string(&doc).unwrap()
    );

    std::fs::write(&doc, r#"{"type":"doc","content":[{"type":"paragraph"}]}"#).unwrap();
    let before = restore_snapshot_in(&state, path.clone(), taken.file.clone(), Some(0), t + DAY)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(before.trigger, Some(Trigger::BeforeRestore));
    assert_eq!(
        std::fs::read_to_string(&doc).unwrap(),
        std::fs::read_to_string(&file).unwrap()
    );

    let history = snapshot_history_in(&state, path.clone()).await.unwrap();
    assert_eq!(
        history
            .snapshots
            .iter()
            .map(|s| s.file.as_str())
            .collect::<Vec<_>>(),
        [before.file.as_str(), taken.file.as_str()]
    );
    assert!(history.bytes >= history.snapshots.iter().map(|s| s.bytes).sum::<u64>());

    // "Clear snapshots older than 3 months", three months on.
    assert_eq!(
        clear_snapshots_in(&state, path.clone(), 90, t + 91 * DAY)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        snapshot_history_in(&state, path)
            .await
            .unwrap()
            .snapshots
            .len(),
        1
    );
}

// M5-1 AC-3
#[tokio::test]
async fn opening_a_project_thins_its_history() {
    let root = scratch("thin");
    let dir = root.join(".erti").join("history").join("Chapter 1");
    std::fs::create_dir_all(&dir).unwrap();
    let now = erti_lib::history::now();
    // Two from the same day a month ago, and one from just now.
    let month_ago = now - 30 * DAY;
    let day = month_ago - month_ago.rem_euclid(DAY);
    for t in [day + 3600, day + 7200, now - 60] {
        std::fs::write(dir.join(name_for(t)), "{}").unwrap();
    }

    let state = DbState::default();
    state.grants.grant(&root);
    open_project_in(&state, root.to_string_lossy().into())
        .await
        .unwrap();

    let doc = root
        .join("Chapter 1.erti.json")
        .to_string_lossy()
        .to_string();
    let left: Vec<i64> = snapshot_history_in(&state, doc)
        .await
        .unwrap()
        .snapshots
        .iter()
        .map(|s| s.taken_at)
        .collect();
    assert_eq!(left, [now - 60, day + 7200]);
}

// M5-1 AC-1
#[tokio::test]
async fn only_a_manuscript_of_the_open_project_has_a_history() {
    let (state, root) = project("refused").await;
    let elsewhere = scratch("refused-elsewhere");
    std::fs::write(elsewhere.join("Theirs.erti.json"), "{}").unwrap();
    std::fs::create_dir_all(root.join("drafts")).unwrap();

    let refused = |path: PathBuf| path.to_string_lossy().to_string();
    for (path, kind) in [
        (
            elsewhere.join("Theirs.erti.json"),
            ErrorKind::PermissionDenied,
        ),
        (
            root.join("drafts")
                .join("..")
                .join("..")
                .join(elsewhere.file_name().unwrap())
                .join("Theirs.erti.json"),
            ErrorKind::PermissionDenied,
        ),
        (
            root.join("drafts").join("Old.erti.json"),
            ErrorKind::PermissionDenied,
        ),
        (root.join("notes.txt"), ErrorKind::InvalidInput),
        (root.join(".erti.json"), ErrorKind::InvalidInput),
        (
            PathBuf::from("Chapter 1.erti.json"),
            ErrorKind::PermissionDenied,
        ),
    ] {
        let err = take_snapshot_in(&state, refused(path.clone()), Trigger::Close, None, 0)
            .await
            .unwrap_err();
        assert_eq!(err.kind, kind, "{path:?}");
    }

    // A manuscript that is a link to someone else's file.
    #[cfg(unix)]
    {
        let link = root.join("Linked.erti.json");
        std::os::unix::fs::symlink(elsewhere.join("Theirs.erti.json"), &link).unwrap();
        let err = take_snapshot_in(&state, refused(link), Trigger::Close, None, 0)
            .await
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::PermissionDenied);
    }

    // Only a snapshot's name is read or restored.
    let doc = refused(root.join("Chapter 1.erti.json"));
    std::fs::write(root.join("Chapter 1.erti.json"), "{}").unwrap();
    for file in ["../../../Chapter 1.erti.json", "snapshots.json"] {
        let err = read_snapshot_in(&state, doc.clone(), file.into())
            .await
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidInput, "{file}");
        let err = restore_snapshot_in(&state, doc.clone(), file.into(), None, 0)
            .await
            .unwrap_err();
        assert_eq!(err.kind, ErrorKind::InvalidInput, "{file}");
    }

    // With no project open, there's nothing to ask about.
    let err = snapshot_history_in(&DbState::default(), doc)
        .await
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::Conflict);
}
