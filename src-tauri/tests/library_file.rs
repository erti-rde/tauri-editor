//! Settings › Library: the backups listed, one restored, and the library moved
//! (M5-10, ADR 008).

use erti_lib::db::{backup, relocate, BackupReport, DbState};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("erti-library-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    // Canonical, as `scope::authorise` hands a picked folder over.
    std::fs::canonicalize(&dir).unwrap()
}

fn quiet() -> BackupReport {
    Arc::new(|e: String| panic!("a backup failed: {e}"))
}

async fn open(path: &Path) -> DbState {
    let state = DbState::default();
    state.open_library_reporting(path, quiet()).await.unwrap();
    state.backups_settled().await;
    state
}

async fn add(state: &DbState, sha: &str) {
    sqlx::query("INSERT INTO sources (sha256) VALUES (?)")
        .bind(sha)
        .execute(&state.library().await.unwrap())
        .await
        .unwrap();
}

async fn sources(state: &DbState) -> Vec<String> {
    sqlx::query_scalar("SELECT sha256 FROM sources ORDER BY sha256")
        .fetch_all(&state.library().await.unwrap())
        .await
        .unwrap()
}

fn names_in(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .map(|d| {
            d.filter_map(|e| e.ok()?.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

fn age(path: &Path, by: Duration) {
    std::fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(SystemTime::now() - by)
        .unwrap();
}

/// A library with one backup from four days ago holding `old`, and `new`
/// added since.
async fn library_with_a_backup(dir: &Path) -> (DbState, String) {
    let library = dir.join("library.db");
    let state = open(&library).await;
    add(&state, "old").await;
    let written = state.back_up_library().await.unwrap();
    let name = "library-2026-01-05.db".to_string();
    std::fs::rename(&written, dir.join("backups").join(&name)).unwrap();
    age(
        &dir.join("backups").join(&name),
        Duration::from_secs(4 * 24 * 60 * 60),
    );
    add(&state, "new").await;
    (state, name)
}

// M5-10 AC-2
#[tokio::test]
async fn the_backups_are_listed_newest_first_with_what_an_upgrade_copy_was_before() {
    let dir = scratch("list");
    let (state, older) = library_with_a_backup(&dir).await;
    let before = dir.join("backups").join("library-2026-01-03-before-v4.db");
    std::fs::copy(dir.join("backups").join(&older), &before).unwrap();
    age(&before, Duration::from_secs(6 * 24 * 60 * 60));
    state.back_up_library().await.unwrap();
    // Not a backup: never listed, never offered.
    std::fs::write(dir.join("backups").join("notes.txt"), "mine").unwrap();

    let listed = relocate::backups(&state).await.unwrap();
    let names: Vec<_> = listed.backups.iter().map(|b| b.name.as_str()).collect();
    let today = backup::date_string(backup::day_of(SystemTime::now()));
    assert_eq!(
        names,
        [
            format!("library-{today}.db").as_str(),
            "library-2026-01-05.db",
            "library-2026-01-03-before-v4.db"
        ]
    );
    assert_eq!(listed.backups[2].before_version, Some(4));
    assert_eq!(listed.backups[0].before_version, None);
    assert!(listed.backups[0].taken_at > listed.backups[1].taken_at);
    assert_eq!(listed.path, dir.join("library.db").to_string_lossy());
    assert_eq!(listed.folder, dir.join("backups").to_string_lossy());
    assert_eq!((listed.keep_days, listed.keep_weeks), (7, 4));
}

// M5-10 AC-2
#[tokio::test]
async fn a_restore_puts_the_backup_in_place_and_keeps_the_library_it_replaced() {
    let dir = scratch("restore");
    let (state, name) = library_with_a_backup(&dir).await;

    let restored = relocate::restore(&state, &name, quiet()).await.unwrap();

    // Open, and holding what the backup held.
    assert_eq!(sources(&state).await, ["old"]);
    assert!(restored.replaced.starts_with("library-replaced-"));
    // The library as it was, kept beside the backups, whole.
    let kept = open(&dir.join("backups").join(&restored.replaced)).await;
    assert_eq!(sources(&kept).await, ["new", "old"]);
    // The backup itself is still there to restore again.
    assert!(dir.join("backups").join(&name).exists());
    // Listed, as the library a restore replaced, but never read as a backup,
    // so pruning never takes it.
    let listed = relocate::backups(&state).await.unwrap();
    let copy = listed
        .backups
        .iter()
        .find(|b| b.name == restored.replaced)
        .expect("the replaced library is listed");
    assert!(copy.replaced);
    assert_eq!(copy.before_version, None);
    assert!(listed
        .backups
        .iter()
        .all(|b| b.replaced == (b.name == restored.replaced)));
    assert!(backup::day_of_name(&restored.replaced).is_none());
}

// M5-10 AC-2
#[tokio::test]
async fn a_restore_is_undone_by_restoring_the_library_it_kept() {
    let dir = scratch("restore-undone");
    let (state, name) = library_with_a_backup(&dir).await;

    let first = relocate::restore(&state, &name, quiet()).await.unwrap();
    assert_eq!(sources(&state).await, ["old"]);
    relocate::restore(&state, &first.replaced, quiet())
        .await
        .unwrap();

    assert_eq!(sources(&state).await, ["new", "old"]);
}

/// A write begun before `during` starts and committed while it runs, as an
/// import's would be: `during` must wait for it, and keep it.
async fn written_during<F: std::future::Future>(state: &DbState, during: F) -> F::Output {
    let pool = state.library().await.unwrap();
    let mut late = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO sources (sha256) VALUES ('late')")
        .execute(&mut *late)
        .await
        .unwrap();
    let commit = async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        late.commit().await.unwrap();
    };
    let (output, ()) = tokio::join!(during, commit);
    output
}

// M5-10 AC-2
#[tokio::test]
async fn a_restore_keeps_what_was_written_while_it_ran() {
    let dir = scratch("restore-late");
    let (state, name) = library_with_a_backup(&dir).await;

    let restored = written_during(&state, relocate::restore(&state, &name, quiet()))
        .await
        .unwrap();

    let kept = open(&dir.join("backups").join(&restored.replaced)).await;
    assert_eq!(sources(&kept).await, ["late", "new", "old"]);
}

// M5-10 AC-2
#[tokio::test]
async fn a_restore_takes_only_a_name_the_backup_folder_lists() {
    let dir = scratch("restore-refused");
    let (state, _) = library_with_a_backup(&dir).await;
    std::fs::write(dir.join("elsewhere.db"), "not a library").unwrap();

    for name in [
        "../elsewhere.db",
        "library-2026-01-05-before-v/../../elsewhere.db",
        "library-2030-01-01.db",
        "notes.txt",
    ] {
        let refused = relocate::restore(&state, name, quiet()).await.unwrap_err();
        assert_eq!(refused.kind, erti_lib::ipc::ErrorKind::NotFound, "{name}");
    }
    // Nothing touched, and still open.
    assert_eq!(sources(&state).await, ["new", "old"]);
    assert!(names_in(&dir.join("backups"))
        .iter()
        .all(|n| !n.starts_with("library-replaced-")));
}

// M5-10 AC-2
#[tokio::test]
async fn a_backup_that_will_not_open_leaves_the_library_as_it_was() {
    let dir = scratch("restore-broken");
    let (state, name) = library_with_a_backup(&dir).await;
    std::fs::write(dir.join("backups").join(&name), "not a database at all").unwrap();

    let failed = relocate::restore(&state, &name, quiet()).await.unwrap_err();

    assert!(
        failed.message.contains("Your library is as it was"),
        "{}",
        failed.message
    );
    assert_eq!(sources(&state).await, ["new", "old"]);
}

/// The paths `move_library` recorded as the `libraryPath` setting.
type Recorded = Arc<Mutex<Vec<PathBuf>>>;

/// Records them, for asserting on.
fn recorder() -> (impl Fn(&Path) -> Result<(), String>, Recorded) {
    let seen: Recorded = Arc::default();
    let sink = seen.clone();
    (
        move |path: &Path| {
            sink.lock().unwrap().push(path.to_path_buf());
            Ok(())
        },
        seen,
    )
}

// M5-10 AC-1
#[tokio::test]
async fn a_move_takes_the_library_and_its_backups_and_reopens_it_there() {
    let dir = scratch("move");
    let (state, name) = library_with_a_backup(&dir).await;
    let to = dir.join("Dropbox");
    std::fs::create_dir_all(&to).unwrap();
    let (remember, seen) = recorder();

    let moved = relocate::relocate(&state, &to, quiet(), remember)
        .await
        .unwrap();

    assert_eq!(moved.path, to.join("library.db").to_string_lossy());
    assert_eq!(moved.backups_left, 0);
    assert_eq!(*seen.lock().unwrap(), [to.join("library.db")]);
    // Open there, with everything in it.
    assert_eq!(state.library_path().await.unwrap(), to.join("library.db"));
    assert_eq!(sources(&state).await, ["new", "old"]);
    // The backups came too, and the old file is gone.
    assert!(to.join("backups").join(&name).exists());
    assert!(!dir.join("library.db").exists());
    assert!(!dir.join("backups").exists());
}

// M5-10 AC-1
#[tokio::test]
async fn a_move_keeps_what_was_written_while_it_ran() {
    let dir = scratch("move-late");
    let (state, _) = library_with_a_backup(&dir).await;
    let to = dir.join("Dropbox");
    std::fs::create_dir_all(&to).unwrap();
    let (remember, _) = recorder();

    written_during(&state, relocate::relocate(&state, &to, quiet(), remember))
        .await
        .unwrap();

    assert_eq!(sources(&state).await, ["late", "new", "old"]);
}

// M5-10 AC-1
#[tokio::test]
async fn a_move_takes_the_libraries_restores_replaced() {
    let dir = scratch("move-replaced");
    let (state, name) = library_with_a_backup(&dir).await;
    let restored = relocate::restore(&state, &name, quiet()).await.unwrap();
    let to = dir.join("Dropbox");
    std::fs::create_dir_all(&to).unwrap();
    let (remember, _) = recorder();

    let moved = relocate::relocate(&state, &to, quiet(), remember)
        .await
        .unwrap();

    assert_eq!(moved.backups_left, 0);
    assert!(to.join("backups").join(&restored.replaced).exists());
    assert!(!dir.join("backups").exists());
}

// M5-10 AC-1
#[tokio::test]
async fn a_move_onto_another_library_is_refused_and_changes_nothing() {
    let dir = scratch("move-taken");
    let (state, _) = library_with_a_backup(&dir).await;
    let to = dir.join("taken");
    std::fs::create_dir_all(&to).unwrap();
    std::fs::write(to.join("library.db"), "someone else's").unwrap();
    let (remember, seen) = recorder();

    let refused = relocate::relocate(&state, &to, quiet(), remember)
        .await
        .unwrap_err();

    assert_eq!(refused.kind, erti_lib::ipc::ErrorKind::Conflict);
    assert!(seen.lock().unwrap().is_empty());
    assert_eq!(
        std::fs::read_to_string(to.join("library.db")).unwrap(),
        "someone else's"
    );
    assert_eq!(state.library_path().await.unwrap(), dir.join("library.db"));
    assert_eq!(sources(&state).await, ["new", "old"]);
}

// M5-10 AC-1
#[tokio::test]
async fn a_move_whose_new_place_cannot_be_recorded_stays_where_it_was() {
    let dir = scratch("move-unrecorded");
    let (state, name) = library_with_a_backup(&dir).await;
    let to = dir.join("elsewhere");
    std::fs::create_dir_all(&to).unwrap();

    let failed = relocate::relocate(&state, &to, quiet(), |_| Err("disk full".into()))
        .await
        .unwrap_err();

    assert!(
        failed.message.contains("stayed where it was"),
        "{}",
        failed.message
    );
    assert!(names_in(&to).is_empty(), "the copy was left behind");
    assert_eq!(state.library_path().await.unwrap(), dir.join("library.db"));
    assert_eq!(sources(&state).await, ["new", "old"]);
    assert!(dir.join("backups").join(&name).exists());
}

// M5-10 AC-1
#[tokio::test]
async fn a_move_to_the_folder_it_is_in_changes_nothing() {
    let dir = scratch("move-same");
    let (state, _) = library_with_a_backup(&dir).await;
    let (remember, seen) = recorder();

    let moved = relocate::relocate(&state, &dir, quiet(), remember)
        .await
        .unwrap();

    assert_eq!(moved.path, dir.join("library.db").to_string_lossy());
    assert!(seen.lock().unwrap().is_empty());
    assert_eq!(sources(&state).await, ["new", "old"]);
}
