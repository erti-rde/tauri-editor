//! A manuscript renamed, duplicated and deleted, through the commands (M5-7).
//!
//! Each goes through what the webview calls: only a manuscript of the open
//! project, and its history kept with it.

use erti_lib::db::DbState;
use erti_lib::db_commands::open_project_in;
use erti_lib::documents::{duplicate_document_in, rename_document_in, trash_document_in};
use erti_lib::history::{snapshot_history_in, take_snapshot_in, time_of_name, Trigger};
use erti_lib::ipc::ErrorKind;
use std::path::{Path, PathBuf};

fn scratch(name: &str) -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("erti-document-menu-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::canonicalize(dir).unwrap()
}

/// A project the user picked, open, with one manuscript in it.
async fn project(name: &str) -> (DbState, PathBuf, String) {
    let root = scratch(name);
    let state = DbState::default();
    state.grants.grant(&root);
    open_project_in(&state, root.to_string_lossy().into())
        .await
        .unwrap();
    let doc = root.join("Chapter 1.erti.json");
    std::fs::write(&doc, r#"{"type":"doc","content":[]}"#).unwrap();
    (state, root, doc.to_string_lossy().into())
}

fn at(stamp: &str) -> i64 {
    time_of_name(&format!("{stamp}.erti.json")).unwrap()
}

fn history(root: &Path, stem: &str) -> PathBuf {
    root.join(".erti").join("history").join(stem)
}

fn names_in(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .collect();
    names.sort();
    names
}

// M5-7 AC-2
#[tokio::test]
async fn renaming_moves_the_manuscript_and_its_history() {
    let (state, root, doc) = project("rename").await;
    take_snapshot_in(
        &state,
        doc.clone(),
        Trigger::Close,
        Some(3),
        at("2026-10-12T16-00-00Z"),
    )
    .await
    .unwrap()
    .unwrap();

    let renamed = rename_document_in(&state, doc.clone(), "Introduction.erti.json".into())
        .await
        .unwrap();

    assert_eq!(
        renamed,
        root.join("Introduction.erti.json").to_string_lossy()
    );
    assert!(!Path::new(&doc).exists());
    assert!(Path::new(&renamed).exists());
    assert!(!history(&root, "Chapter 1").exists());
    // History finds it under the new name, labels and all.
    let found = snapshot_history_in(&state, renamed).await.unwrap();
    assert_eq!(found.snapshots.len(), 1);
    assert_eq!(found.snapshots[0].trigger, Some(Trigger::Close));
    assert_eq!(found.snapshots[0].words, Some(3));
}

#[tokio::test]
async fn renaming_never_overwrites_another_document() {
    let (state, root, doc) = project("rename-taken").await;
    let other = root.join("Methods.erti.json");
    std::fs::write(&other, "theirs").unwrap();

    let refused = rename_document_in(&state, doc.clone(), "Methods.erti.json".into())
        .await
        .unwrap_err();

    assert_eq!(refused.kind, ErrorKind::Conflict);
    assert!(refused.message.contains("“Methods” is already here"));
    assert_eq!(std::fs::read_to_string(&other).unwrap(), "theirs");
    assert!(Path::new(&doc).exists());
}

#[tokio::test]
async fn renaming_into_a_kept_history_joins_it_and_loses_nothing() {
    // "Methods" was deleted, and its history kept (AC-2). Chapter 1 renamed
    // to Methods brings its own snapshots into that folder.
    let (state, root, doc) = project("rename-merge").await;
    let t = at("2026-10-12T16-00-00Z");
    take_snapshot_in(&state, doc.clone(), Trigger::Close, Some(3), t)
        .await
        .unwrap()
        .unwrap();
    let kept = history(&root, "Methods");
    std::fs::create_dir_all(&kept).unwrap();
    // The same second as Chapter 1's, so one has to move along.
    std::fs::write(kept.join("2026-10-12T16-00-00Z.erti.json"), "old methods").unwrap();

    let renamed = rename_document_in(&state, doc, "Methods.erti.json".into())
        .await
        .unwrap();

    let found = snapshot_history_in(&state, renamed).await.unwrap();
    assert_eq!(found.snapshots.len(), 2);
    assert_eq!(found.snapshots[0].taken_at, t + 1);
    assert_eq!(found.snapshots[0].trigger, Some(Trigger::Close));
    assert_eq!(
        std::fs::read_to_string(kept.join("2026-10-12T16-00-00Z.erti.json")).unwrap(),
        "old methods"
    );
    assert!(!history(&root, "Chapter 1").exists());
}

#[tokio::test]
async fn a_history_that_cannot_join_is_put_back_and_the_name_kept() {
    // Methods' kept history can't take an index (here, a folder sits where it
    // goes). Chapter 1's snapshots moved into it come back, and so does its name.
    let (state, root, doc) = project("rename-merge-fails").await;
    let t = at("2026-10-12T16-00-00Z");
    take_snapshot_in(&state, doc.clone(), Trigger::Close, Some(3), t)
        .await
        .unwrap()
        .unwrap();
    let kept = history(&root, "Methods");
    std::fs::create_dir_all(kept.join("snapshots.json")).unwrap();
    std::fs::write(kept.join("2026-10-11T09-00-00Z.erti.json"), "old methods").unwrap();

    let refused = rename_document_in(&state, doc.clone(), "Methods.erti.json".into())
        .await
        .unwrap_err();

    assert_eq!(refused.kind, ErrorKind::Io);
    assert!(Path::new(&doc).exists());
    assert!(!root.join("Methods.erti.json").exists());
    let found = snapshot_history_in(&state, doc).await.unwrap();
    assert_eq!(found.snapshots.len(), 1);
    assert_eq!(found.snapshots[0].trigger, Some(Trigger::Close));
    assert_eq!(
        names_in(&kept),
        ["2026-10-11T09-00-00Z.erti.json", "snapshots.json"]
    );
}

#[tokio::test]
async fn a_rename_is_a_name_not_a_path() {
    let (state, root, doc) = project("rename-path").await;
    for name in [
        "../Elsewhere.erti.json",
        "sub/Chapter.erti.json",
        r"sub\Chapter.erti.json",
        "Chapter",
        ".erti.json",
        "magnum_opus.json",
    ] {
        let refused = rename_document_in(&state, doc.clone(), name.into())
            .await
            .unwrap_err();
        assert_eq!(refused.kind, ErrorKind::InvalidInput, "{name}");
    }
    assert!(Path::new(&doc).exists());
    assert!(!root.parent().unwrap().join("Elsewhere.erti.json").exists());
}

#[tokio::test]
async fn a_case_only_rename_is_allowed() {
    let (state, root, doc) = project("rename-case").await;

    let renamed = rename_document_in(&state, doc, "chapter 1.erti.json".into())
        .await
        .unwrap();

    assert!(Path::new(&renamed).exists());
    assert!(names_in(&root).contains(&"chapter 1.erti.json".to_owned()));
}

#[tokio::test]
async fn duplicating_writes_a_copy_beside_it_with_no_history() {
    let (state, root, doc) = project("duplicate").await;
    take_snapshot_in(
        &state,
        doc.clone(),
        Trigger::Close,
        None,
        at("2026-10-12T16-00-00Z"),
    )
    .await
    .unwrap();

    let first = duplicate_document_in(&state, doc.clone()).await.unwrap();
    let second = duplicate_document_in(&state, doc.clone()).await.unwrap();

    assert_eq!(
        first,
        root.join("Chapter 1 copy.erti.json").to_string_lossy()
    );
    assert_eq!(
        second,
        root.join("Chapter 1 copy 2.erti.json").to_string_lossy()
    );
    assert_eq!(
        std::fs::read_to_string(&first).unwrap(),
        std::fs::read_to_string(&doc).unwrap()
    );
    let copied = snapshot_history_in(&state, first).await.unwrap();
    assert!(copied.snapshots.is_empty());
}

#[tokio::test]
async fn the_document_from_before_1_0_duplicates_under_its_title() {
    let (state, root, _) = project("duplicate-legacy").await;
    let legacy = root.join("magnum_opus.json");
    std::fs::write(&legacy, "{}").unwrap();

    let copy = duplicate_document_in(&state, legacy.to_string_lossy().into())
        .await
        .unwrap();

    assert_eq!(
        copy,
        root.join("Untitled document copy.erti.json")
            .to_string_lossy()
    );
}

// M5-7 AC-2, AC-3
#[tokio::test]
async fn deleting_moves_the_file_away_and_keeps_its_history() {
    let (state, root, doc) = project("trash").await;
    take_snapshot_in(
        &state,
        doc.clone(),
        Trigger::Close,
        None,
        at("2026-10-12T16-00-00Z"),
    )
    .await
    .unwrap();
    let bin = scratch("trash-bin");
    let into = bin.clone();

    trash_document_in(&state, doc.clone(), move |path| {
        std::fs::rename(path, into.join(path.file_name().unwrap())).map_err(|e| e.to_string())
    })
    .await
    .unwrap();

    assert!(!Path::new(&doc).exists());
    assert!(bin.join("Chapter 1.erti.json").exists());
    let kept = snapshot_history_in(&state, doc).await.unwrap();
    assert_eq!(kept.snapshots.len(), 1);
    assert!(history(&root, "Chapter 1").exists());
}

// M5-7 AC-3
#[tokio::test]
async fn only_a_manuscript_of_the_open_project_can_be_deleted() {
    let (state, root, _) = project("trash-scope").await;
    let outside = scratch("trash-outside").join("Theirs.erti.json");
    std::fs::write(&outside, "{}").unwrap();
    let paper = root.join("paper.pdf");
    std::fs::write(&paper, "%PDF").unwrap();
    let nested = root.join("drafts");
    std::fs::create_dir_all(&nested).unwrap();
    std::fs::write(nested.join("Old.erti.json"), "{}").unwrap();

    for (path, kind) in [
        (outside.clone(), ErrorKind::PermissionDenied),
        (nested.join("Old.erti.json"), ErrorKind::PermissionDenied),
        (paper.clone(), ErrorKind::InvalidInput),
        (root.join("Gone.erti.json"), ErrorKind::NotFound),
    ] {
        let refused = trash_document_in(&state, path.to_string_lossy().into(), |_| {
            panic!("nothing should be discarded")
        })
        .await
        .unwrap_err();
        assert_eq!(refused.kind, kind, "{path:?}");
    }
    assert!(outside.exists());
    assert!(paper.exists());
}

#[tokio::test]
async fn a_trash_that_refuses_leaves_the_document_and_says_so() {
    let (state, _, doc) = project("trash-refused").await;

    let refused = trash_document_in(&state, doc.clone(), |_| Err("no trash here".into()))
        .await
        .unwrap_err();

    assert_eq!(refused.kind, ErrorKind::Io);
    assert!(refused.message.contains("still here"));
    assert!(Path::new(&doc).exists());
}
