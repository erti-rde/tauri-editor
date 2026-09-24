//! A second copy of the library, kept without anyone asking (ADR 008, M1a-5).

use erti_lib::db::{backup, schema, BackupReport, DbState};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("erti-backup-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn today() -> String {
    backup::date_string(backup::day_of(SystemTime::now()))
}

/// Failures reported, for asserting on.
fn recorder() -> (BackupReport, Arc<Mutex<Vec<String>>>) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    (
        Arc::new(move |e: String| sink.lock().unwrap().push(e)),
        seen,
    )
}

async fn open(path: &Path) -> (DbState, Arc<Mutex<Vec<String>>>) {
    let state = DbState::default();
    let (report, seen) = recorder();
    state.open_library_reporting(path, report).await.unwrap();
    state.backups_settled().await;
    (state, seen)
}

/// A library a previous build left: every migration up to `version`.
async fn library_at_version(path: &Path, version: i64) {
    let pool = SqlitePool::connect(&format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    for migration in schema::LIBRARY_MIGRATIONS
        .iter()
        .filter(|m| m.to <= version)
    {
        sqlx::raw_sql(migration.sql).execute(&pool).await.unwrap();
    }
    sqlx::raw_sql("CREATE TABLE schema_version (version INTEGER NOT NULL)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO schema_version (version) VALUES (?)")
        .bind(version)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO sources (sha256) VALUES ('kept-through-the-upgrade')")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
}

async fn version_of(path: &Path) -> i64 {
    let pool = SqlitePool::connect(&format!("sqlite:{}?mode=ro", path.display()))
        .await
        .unwrap();
    let v = sqlx::query_scalar("SELECT MAX(version) FROM schema_version")
        .fetch_one(&pool)
        .await
        .unwrap();
    pool.close().await;
    v
}

fn backups_in(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir.join("backups"))
        .map(|d| {
            d.filter_map(|e| e.ok()?.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

#[tokio::test]
async fn a_brand_new_library_has_nothing_to_back_up() {
    let dir = scratch("new");
    open(&dir.join("library.db")).await;
    assert!(backups_in(&dir).is_empty());
}

// M1a-5 AC-1
#[tokio::test]
async fn opening_takes_a_daily_backup_once_a_day() {
    let dir = scratch("daily");
    let library = dir.join("library.db");
    library_at_version(&library, schema::LIBRARY_VERSION).await;

    open(&library).await;
    let daily = format!("library-{}.db", today());
    assert_eq!(backups_in(&dir), vec![daily.clone()]);

    // Opened again the same day: nothing new.
    let first = std::fs::metadata(dir.join("backups").join(&daily))
        .unwrap()
        .modified()
        .unwrap();
    open(&library).await;
    assert_eq!(backups_in(&dir), vec![daily.clone()]);

    // A day later by the clock on the file: due again.
    let yesterday = SystemTime::now() - Duration::from_secs(25 * 60 * 60);
    std::fs::File::options()
        .write(true)
        .open(dir.join("backups").join(&daily))
        .unwrap()
        .set_modified(yesterday)
        .unwrap();
    open(&library).await;
    let again = std::fs::metadata(dir.join("backups").join(&daily))
        .unwrap()
        .modified()
        .unwrap();
    assert!(again > first, "the backup was not taken again");
}

// M1a-5 AC-2
#[tokio::test]
async fn a_migration_is_preceded_by_a_backup_of_the_library_as_it_was() {
    let dir = scratch("migration");
    let library = dir.join("library.db");
    library_at_version(&library, 4).await;

    open(&library).await;

    let before = dir
        .join("backups")
        .join(format!("library-{}-before-v4.db", today()));
    assert!(
        before.exists(),
        "no pre-migration backup in {:?}",
        backups_in(&dir)
    );
    // Still at the old version: taken before the first statement of the upgrade.
    assert_eq!(version_of(&before).await, 4);
    assert_eq!(version_of(&library).await, schema::LIBRARY_VERSION);
}

// M1a-5 AC-4
#[tokio::test]
async fn a_backup_opens_as_a_library_at_the_same_version() {
    let dir = scratch("valid");
    let library = dir.join("library.db");
    library_at_version(&library, schema::LIBRARY_VERSION).await;
    open(&library).await;

    let copy = dir.join("restored").join("library.db");
    std::fs::create_dir_all(copy.parent().unwrap()).unwrap();
    std::fs::copy(
        dir.join("backups").join(format!("library-{}.db", today())),
        &copy,
    )
    .unwrap();

    assert_eq!(version_of(&copy).await, schema::LIBRARY_VERSION);
    let (restored, _) = open(&copy).await;
    let pool = restored.library().await.unwrap();
    let sha: String = sqlx::query_scalar("SELECT sha256 FROM sources")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sha, "kept-through-the-upgrade");
}

// M1a-5 AC-5
#[tokio::test]
async fn a_failed_backup_is_reported_and_the_library_opens_anyway() {
    let dir = scratch("failing");
    let library = dir.join("library.db");
    library_at_version(&library, 4).await;
    // A file where the backups folder should be: nothing can be written there.
    std::fs::write(dir.join("backups"), "in the way").unwrap();

    let (state, seen) = open(&library).await;

    assert!(state.library().await.is_ok());
    assert_eq!(version_of(&library).await, schema::LIBRARY_VERSION);
    let seen = seen.lock().unwrap();
    assert!(!seen.is_empty(), "the failure was not reported");
    assert!(seen[0].contains("backups"), "{seen:?}");
}

// M1a-5 AC-3, on disk
#[tokio::test]
async fn old_backups_are_pruned_when_a_new_one_is_written() {
    let dir = scratch("prune");
    let library = dir.join("library.db");
    library_at_version(&library, schema::LIBRARY_VERSION).await;
    let backups = dir.join("backups");
    std::fs::create_dir_all(&backups).unwrap();

    let now = backup::day_of(SystemTime::now());
    let old = SystemTime::now() - Duration::from_secs(2 * 24 * 60 * 60);
    for back in 1..=40 {
        let path = backups.join(format!("library-{}.db", backup::date_string(now - back)));
        std::fs::write(&path, "").unwrap();
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(old)
            .unwrap();
    }
    std::fs::write(backups.join("keep-me.txt"), "not a backup").unwrap();

    open(&library).await;

    let names = backups_in(&dir);
    let copies = names.iter().filter(|n| n.starts_with("library-")).count();
    assert_eq!(copies, backup::KEEP_DAYS + backup::KEEP_WEEKS, "{names:?}");
    assert!(names.contains(&format!("library-{}.db", today())));
    assert!(names.contains(&"keep-me.txt".to_string()));
}
