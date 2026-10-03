//! Library migration 6: aliases, source notes and their embeddings (M1b-2).
//!
//! The library being upgraded is built from the frozen migrations 2 to 5 and
//! holds what a researcher's would: a source, its file's location, chunks, a
//! highlight and its embedding. The upgrade has to keep every one of them.

use erti_lib::db::{backup, schema, BackupReport, DbState};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("erti-m6-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

const PDF: &str = "a3f1c0ffee";

/// A version 5 library as the build before this one left it, with work in it.
async fn v5_library(path: &Path) {
    let pool = SqlitePool::connect(&format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    for migration in schema::LIBRARY_MIGRATIONS.iter().filter(|m| m.to <= 5) {
        sqlx::raw_sql(migration.sql).execute(&pool).await.unwrap();
    }
    sqlx::raw_sql(&format!(
        "CREATE TABLE schema_version (version INTEGER NOT NULL);
         INSERT INTO schema_version (version) VALUES (5);
         INSERT INTO sources (sha256, csl_json) VALUES ('{PDF}', '{{\"title\":\"Kept\"}}');
         INSERT INTO locations (sha256, path, file_name) VALUES ('{PDF}', '/papers/kept.pdf', 'kept.pdf');
         INSERT INTO chunks (sha256, idx, text, embedding) VALUES ('{PDF}', 0, 'A sentence.', x'00000000');
         INSERT INTO annotations (id, sha256, kind, page, quote, page_label)
             VALUES ('mark-1', '{PDF}', 'highlight', 3, 'marked words', '853');
         INSERT INTO annotation_embeddings (id, embedding, text_hash) VALUES ('mark-1', x'00000000', 'h');"
    ))
    .execute(&pool)
    .await
    .unwrap();
    pool.close().await;
}

async fn open(path: &Path) -> (DbState, Arc<Mutex<Vec<String>>>) {
    let state = DbState::default();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    let report: BackupReport = Arc::new(move |e: String| sink.lock().unwrap().push(e));
    state.open_library_reporting(path, report).await.unwrap();
    state.backups_settled().await;
    (state, seen)
}

async fn count(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

async fn tables(pool: &SqlitePool) -> Vec<String> {
    sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .fetch_all(pool)
        .await
        .unwrap()
}

// M1b-2 AC-1
#[tokio::test]
async fn migration_6_adds_aliases_notes_and_note_embeddings() {
    let dir = scratch("tables");
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await.unwrap();
    let library = state.library().await.unwrap();

    let found = tables(&library).await;
    for table in ["source_aliases", "source_notes", "source_note_embeddings"] {
        assert!(found.contains(&table.to_string()), "{table} is missing");
    }

    // The columns ADR 004 names, as SQLite reports them.
    let columns: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info('source_notes') ORDER BY cid")
            .fetch_all(&library)
            .await
            .unwrap();
    assert_eq!(
        columns,
        [
            "id",
            "sha256",
            "body",
            "quote",
            "page_label",
            "label_id",
            "created_at",
            "updated_at"
        ]
    );
}

// M1b-2 AC-1
#[tokio::test]
async fn the_alias_table_keeps_what_sql_can_keep() {
    let dir = scratch("constraints");
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await.unwrap();
    let library = state.library().await.unwrap();

    sqlx::raw_sql(
        "INSERT INTO sources (sha256) VALUES ('erti:0b9e'), ('f00d');
         INSERT INTO source_aliases (alias, canonical) VALUES ('f00d', 'erti:0b9e');",
    )
    .execute(&library)
    .await
    .unwrap();

    // An id can't be an alias of itself, and both ids must be sources.
    for refused in [
        "INSERT INTO source_aliases (alias, canonical) VALUES ('erti:0b9e', 'erti:0b9e')",
        "INSERT INTO source_aliases (alias, canonical) VALUES ('nowhere', 'erti:0b9e')",
        "INSERT INTO source_aliases (alias, canonical) VALUES ('erti:0b9e', 'nowhere')",
    ] {
        assert!(
            sqlx::query(refused).execute(&library).await.is_err(),
            "accepted: {refused}"
        );
    }

    // Removing the work takes its alias rows; the file's own row stays.
    sqlx::query("DELETE FROM sources WHERE sha256 = 'erti:0b9e'")
        .execute(&library)
        .await
        .unwrap();
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM source_aliases").await,
        0
    );
    assert_eq!(
        count(
            &library,
            "SELECT COUNT(*) FROM sources WHERE sha256 = 'f00d'"
        )
        .await,
        1
    );
}

// M1b-2 AC-1
#[tokio::test]
async fn removing_a_source_removes_its_notes_and_their_embeddings() {
    let dir = scratch("notes");
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await.unwrap();
    let library = state.library().await.unwrap();

    // The print-book case: a source with no file, a note with a quote and a page.
    sqlx::raw_sql(
        "INSERT INTO sources (sha256) VALUES ('erti:book');
         INSERT INTO source_notes (id, sha256, body, quote, page_label, label_id)
             VALUES ('note-1', 'erti:book', '', 'printed words', 'xii', 'claim');
         INSERT INTO source_note_embeddings (id, embedding, text_hash)
             VALUES ('note-1', x'00000000', 'h');",
    )
    .execute(&library)
    .await
    .unwrap();

    // A note must belong to a source.
    assert!(
        sqlx::query("INSERT INTO source_notes (id, sha256) VALUES ('stray', 'nowhere')")
            .execute(&library)
            .await
            .is_err()
    );

    sqlx::query("DELETE FROM sources WHERE sha256 = 'erti:book'")
        .execute(&library)
        .await
        .unwrap();
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM source_notes").await,
        0
    );
    assert_eq!(
        count(&library, "SELECT COUNT(*) FROM source_note_embeddings").await,
        0
    );
}

// M1b-2 AC-2
#[tokio::test]
async fn a_v5_library_upgrades_after_a_backup_and_keeps_its_work() {
    let dir = scratch("upgrade");
    let path = dir.join("library.db");
    v5_library(&path).await;

    let (state, failures) = open(&path).await;
    assert!(failures.lock().unwrap().is_empty(), "{failures:?}");
    let library = state.library().await.unwrap();

    assert_eq!(
        count(&library, "SELECT MAX(version) FROM schema_version").await,
        6
    );
    for table in ["source_aliases", "source_notes", "source_note_embeddings"] {
        assert!(tables(&library).await.contains(&table.to_string()));
    }

    // Nothing that was there before is lost.
    for (what, sql) in [
        ("source", "SELECT COUNT(*) FROM sources"),
        ("location", "SELECT COUNT(*) FROM locations"),
        ("chunk", "SELECT COUNT(*) FROM chunks"),
        (
            "highlight",
            "SELECT COUNT(*) FROM annotations WHERE page_label = '853'",
        ),
        ("embedding", "SELECT COUNT(*) FROM annotation_embeddings"),
        ("label", "SELECT COUNT(*) FROM annotation_labels"),
    ] {
        assert!(count(&library, sql).await > 0, "the {what} was lost");
    }
    let broken: Vec<(String, i64, String, i64)> = sqlx::query_as("PRAGMA foreign_key_check")
        .fetch_all(&library)
        .await
        .unwrap();
    assert!(broken.is_empty(), "{broken:?}");

    // The backup is the library as it was: version 5, and the same work.
    let day = backup::date_string(backup::day_of(SystemTime::now()));
    let before = dir
        .join("backups")
        .join(format!("library-{day}-before-v5.db"));
    let copy = SqlitePool::connect(&format!("sqlite:{}?mode=ro", before.display()))
        .await
        .unwrap();
    assert_eq!(
        count(&copy, "SELECT MAX(version) FROM schema_version").await,
        5
    );
    assert_eq!(count(&copy, "SELECT COUNT(*) FROM annotations").await, 1);
    assert!(!tables(&copy).await.contains(&"source_notes".to_string()));
    copy.close().await;
}
