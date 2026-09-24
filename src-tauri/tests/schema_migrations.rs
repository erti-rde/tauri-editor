//! The upgrade path, which has no second chance.
//!
//! A library is a researcher's corpus and there is one copy of it. The failure
//! this guards against is silent: the baseline schema is written with
//! `CREATE TABLE IF NOT EXISTS`, so replaying it over an existing database does
//! nothing, and anything added to it would simply never appear for anyone who
//! already had a library. The build would then query for a column that is not
//! there.

use erti_lib::db::{queries, schema, DbState};
use sqlx::SqlitePool;
use std::path::PathBuf;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("erti-migrate-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Every table, index and column, as SQLite itself reports them.
///
/// Read from `sqlite_master` rather than compared as SQL text, so formatting or
/// comment differences between the baseline and a migration do not register as
/// a difference while a genuinely missing column would.
async fn shape(pool: &SqlitePool) -> Vec<String> {
    let objects: Vec<(String, String)> = sqlx::query_as(
        "SELECT type, name FROM sqlite_master
         WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .fetch_all(pool)
    .await
    .unwrap();

    let mut out = Vec::new();

    for (kind, name) in objects {
        out.push(format!("{kind} {name}"));

        if kind != "table" {
            continue;
        }

        let columns: Vec<(i64, String, String, i64, Option<String>, i64)> =
            sqlx::query_as(&format!("PRAGMA table_info('{name}')"))
                .fetch_all(pool)
                .await
                .unwrap();

        for (_, column, ty, notnull, default, pk) in columns {
            out.push(format!(
                "  {name}.{column} {ty} notnull={notnull} default={default:?} pk={pk}"
            ));
        }
    }

    out
}

/// A library as it stood before annotations, built the way that build built it:
/// every migration up to version 2, and nothing after.
async fn library_at_version(path: &std::path::Path, version: i64) -> SqlitePool {
    let pool = SqlitePool::connect(&format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();

    for migration in schema::LIBRARY_MIGRATIONS
        .iter()
        .filter(|m| m.to <= version)
    {
        sqlx::raw_sql(migration.sql).execute(&pool).await.unwrap();
    }

    sqlx::raw_sql("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO schema_version (version) VALUES (?)")
        .bind(version)
        .execute(&pool)
        .await
        .unwrap();

    pool.close().await;
    pool
}

fn fingerprint(sql: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(sql.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[test]
fn shipped_migrations_are_frozen() {
    // A migration that has shipped built somebody's library, and that library
    // cannot be rebuilt. Editing one changes what new users get and leaves
    // everyone who already ran it behind, with nothing to say so — the drift is
    // invisible because `CREATE TABLE IF NOT EXISTS` fails silently by design.
    //
    // So corrections come as a new migration, never as an edit. When a genuinely
    // new migration is added, append its fingerprint here; if one of these fails,
    // the question to ask is "which library already ran the old text?".
    let expected: &[(i64, &str)] = &[
        (
            2,
            "8855e8e97d1694b9a3b2a51b8cc8a062f2565fce50b11204d2b57a93d1625264",
        ),
        (
            3,
            "921fce4df412a139e75a673b6251e47bdac9899131f893e15cb7ee55597173f9",
        ),
        (
            4,
            "90a0b3d5ec7de9c48aa2c75bd557027112ef487a4d1f9e0299be6d8e5084a723",
        ),
        (
            5,
            "ce44383282c351c8db399db93e20f6bb1ce21951d316b6a5f25f4285f069c210",
        ),
    ];

    assert_eq!(
        schema::LIBRARY_MIGRATIONS.len(),
        expected.len(),
        "a migration was added or removed without updating the fingerprints"
    );

    for (migration, (to, hash)) in schema::LIBRARY_MIGRATIONS.iter().zip(expected) {
        assert_eq!(migration.to, *to, "migrations are out of order");
        assert_eq!(
            &fingerprint(migration.sql),
            hash,
            "the migration to schema {to} has been edited after shipping",
        );
    }
}

#[test]
fn migrations_are_in_ascending_order() {
    // apply_schema filters on `to > current`, so an out-of-order list would skip
    // a migration rather than fail.
    for pair in schema::LIBRARY_MIGRATIONS.windows(2) {
        assert!(pair[0].to < pair[1].to, "migrations must ascend");
    }
    assert_eq!(
        schema::LIBRARY_MIGRATIONS.last().map(|m| m.to),
        Some(schema::LIBRARY_VERSION),
        "the last migration must reach the declared version"
    );
}

#[tokio::test]
async fn migrations_are_idempotent() {
    // There is no transaction around the upgrade — sqlx's Transaction held
    // across an await makes the future higher-ranked over the connection
    // lifetime, which #[tauri::command] rejects outright. So a migration that
    // fails partway, or a machine that loses power mid-upgrade, leaves the old
    // version recorded and the whole set runs again. That is only safe while
    // every migration can be re-run.
    let dir = scratch("idempotent");
    let path = dir.join("library.db");

    library_at_version(&path, 2).await;

    let pool = SqlitePool::connect(&format!("sqlite:{}", path.display()))
        .await
        .unwrap();

    for pass in 1..=2 {
        for migration in schema::LIBRARY_MIGRATIONS {
            // Through the same guard the runner uses. A migration that declares
            // one is allowed to be non-idempotent in its own SQL — an
            // `ALTER TABLE ADD COLUMN` cannot be otherwise — but the pair of
            // them still has to be safe to re-run, which is what this checks.
            let already: Option<i64> = match migration.skip_if {
                Some(check) => sqlx::query_scalar(check)
                    .fetch_optional(&pool)
                    .await
                    .unwrap(),
                None => None,
            };
            if already.is_some() {
                continue;
            }

            sqlx::raw_sql(migration.sql)
                .execute(&pool)
                .await
                .unwrap_or_else(|e| {
                    panic!(
                        "migration to schema {} is not idempotent — pass {pass} failed: {e}",
                        migration.to
                    )
                });
        }
    }
}

#[tokio::test]
async fn an_interrupted_upgrade_finishes_on_the_next_open() {
    // The version row is written last, so a failure leaves the old version
    // recorded. Opening again has to complete the job rather than believe the
    // half-done state.
    let dir = scratch("resume");
    let path = dir.join("library.db");

    library_at_version(&path, 2).await;

    // Stand in for an upgrade that got partway: one migration applied, no
    // version row written.
    let pool = SqlitePool::connect(&format!("sqlite:{}", path.display()))
        .await
        .unwrap();
    sqlx::raw_sql(schema::LIBRARY_MIGRATIONS[0].sql)
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;

    let state = DbState::default();
    state.open_library(&path).await.unwrap();
    let library = state.library().await.unwrap();

    let version: i64 = sqlx::query_scalar("SELECT MAX(version) FROM schema_version")
        .fetch_one(&library)
        .await
        .unwrap();

    assert_eq!(version, schema::LIBRARY_VERSION);

    // And the work actually landed, rather than the version row alone moving.
    let annotations: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'annotations'",
    )
    .fetch_one(&library)
    .await
    .unwrap();
    assert_eq!(annotations, 1);
}

#[tokio::test]
async fn opening_the_same_library_twice_changes_nothing() {
    let dir = scratch("reopen");
    let path = dir.join("library.db");

    let first = DbState::default();
    first.open_library(&path).await.unwrap();
    let before = shape(&first.library().await.unwrap()).await;

    let second = DbState::default();
    second.open_library(&path).await.unwrap();
    let library = second.library().await.unwrap();

    assert_eq!(shape(&library).await, before);

    // And exactly one version row, rather than one per launch.
    let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schema_version")
        .fetch_one(&library)
        .await
        .unwrap();
    assert_eq!(rows, 1);
}

#[tokio::test]
async fn a_library_from_a_newer_build_is_refused() {
    // Failing closed matters more here than anywhere else: opening a library
    // this build does not understand read-write risks writing over structures
    // it cannot see.
    let dir = scratch("newer");
    let path = dir.join("library.db");

    library_at_version(&path, 2).await;

    let pool = SqlitePool::connect(&format!("sqlite:{}", path.display()))
        .await
        .unwrap();
    sqlx::query("INSERT INTO schema_version (version) VALUES (?)")
        .bind(schema::LIBRARY_VERSION + 5)
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;

    let state = DbState::default();
    let refused = state.open_library(&path).await;

    assert!(refused.is_err());
    assert!(
        refused.unwrap_err().contains("newer version of Erti"),
        "the message has to tell the user what to do about it"
    );
}

#[tokio::test]
async fn annotations_arrive_with_the_upgrade() {
    let dir = scratch("annotations");
    let path = dir.join("library.db");

    library_at_version(&path, 2).await;

    let state = DbState::default();
    state.open_library(&path).await.unwrap();
    let library = state.library().await.unwrap();

    for table in [
        "annotations",
        "annotation_images",
        "annotation_embeddings",
        "annotation_labels",
        "reading_positions",
    ] {
        let found: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .bind(table)
        .fetch_one(&library)
        .await
        .unwrap();

        assert_eq!(found, 1, "{table} should exist after the upgrade");
    }
}

#[test]
fn defaults_match_the_migration() {
    // The labels are inserted by the migration; `DEFAULT_LABELS` exists so the
    // interface can name them without parsing SQL. Two lists of the same thing
    // drift, so this checks they still agree.
    let sql = schema::ANNOTATIONS_SCHEMA;

    for (id, name, colour) in queries::DEFAULT_LABELS {
        assert!(
            sql.contains(&format!("'{id}'")),
            "{id} is in DEFAULT_LABELS but not in the migration"
        );
        assert!(
            sql.contains(&format!("'{name}'")),
            "{name} is in DEFAULT_LABELS but not in the migration"
        );
        assert!(
            sql.contains(&format!("'{colour}'")),
            "the colour for {id} differs between DEFAULT_LABELS and the migration"
        );
    }

    // And nothing extra crept into the SQL: eight rows, eight entries. Counted
    // by tuple rather than by separator, because the VALUES list is aligned and
    // the padding defeats anything matching on ", ".
    let inserted = sql
        .lines()
        .filter(|line| line.trim_start().starts_with("('"))
        .count();
    assert_eq!(
        inserted,
        queries::DEFAULT_LABELS.len(),
        "the migration inserts a different number of labels than DEFAULT_LABELS names"
    );
}
