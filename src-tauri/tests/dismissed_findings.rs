//! Dismissed attribution findings persist with the project (M4-7).
//!
//! Project migration 2 adds `dismissed_findings`. Upgraded here from a project
//! database built the way the shipped build built it: migration 1 and nothing
//! after, with rows in it that must survive.

use erti_lib::db::queries::DismissedFinding;
use erti_lib::db::{schema, DbState};
use erti_lib::db_commands::{dismiss_finding_in, dismissed_findings_in, restore_finding_in};
use sqlx::SqlitePool;
use std::path::PathBuf;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("erti-dismissed-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join(".erti")).unwrap();
    dir
}

/// A project as version 1 left it, with a document and a source in its set.
async fn v1_project(root: &std::path::Path) {
    let path = root.join(".erti").join("project.db");
    let pool = SqlitePool::connect(&format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    sqlx::raw_sql(schema::PROJECT_MIGRATIONS[0].sql)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
         INSERT INTO schema_version (version) VALUES (1);
         INSERT INTO documents (filename, title) VALUES ('chapter-1.erti.json', 'Chapter 1');
         INSERT INTO source_set (sha256) VALUES ('a11ce000');",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool.close().await;
}

fn finding(hash: &str, id: &str, kind: &str) -> DismissedFinding {
    DismissedFinding {
        sentence_hash: hash.into(),
        canonical_id: id.into(),
        kind: kind.into(),
    }
}

// M4-7 AC-1
#[test]
fn shipped_project_migrations_are_frozen() {
    use sha2::{Digest, Sha256};
    let fingerprint = |sql: &str| format!("{:x}", Sha256::digest(sql.as_bytes()));
    let expected: &[(i64, &str)] = &[
        (
            1,
            "d98a4809a50799ed06909464dc5cd0725e7e31e4cda2dfbc56a8aff5fbe2b944",
        ),
        (
            2,
            "6a856467f3276920629340d648ae7df676035d248bb257cd21d87c53601a329e",
        ),
    ];
    assert_eq!(schema::PROJECT_MIGRATIONS.len(), expected.len());
    for (migration, (to, hash)) in schema::PROJECT_MIGRATIONS.iter().zip(expected) {
        assert_eq!(migration.to, *to, "migrations are out of order");
        assert_eq!(
            &fingerprint(migration.sql),
            hash,
            "the project migration to schema {to} has been edited after shipping"
        );
    }
    assert_eq!(
        schema::PROJECT_MIGRATIONS.last().map(|m| m.to),
        Some(schema::PROJECT_VERSION)
    );
}

// M4-7 AC-1
#[tokio::test]
async fn a_version_1_project_gains_dismissals_and_keeps_its_rows() {
    let root = scratch("upgrade");
    v1_project(&root).await;

    let state = DbState::default();
    state.open_project(&root).await.unwrap();
    let project = state.project().await.unwrap();

    let version: i64 = sqlx::query_scalar("SELECT MAX(version) FROM schema_version")
        .fetch_one(&project)
        .await
        .unwrap();
    assert_eq!(version, 2);
    let documents: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM documents")
        .fetch_one(&project)
        .await
        .unwrap();
    let sources: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM source_set")
        .fetch_one(&project)
        .await
        .unwrap();
    assert_eq!((documents, sources), (1, 1));
    assert!(dismissed_findings_in(&state).await.unwrap().is_empty());

    // Idempotent: the migration run again over itself changes nothing.
    for _ in 0..2 {
        sqlx::raw_sql(schema::PROJECT_MIGRATIONS[1].sql)
            .execute(&project)
            .await
            .unwrap();
    }
}

// M4-7 AC-2, AC-3
#[tokio::test]
async fn a_dismissal_survives_reopening_and_can_be_restored() {
    let root = scratch("persist");
    v1_project(&root).await;

    let state = DbState::default();
    state.open_project(&root).await.unwrap();
    let uncited = finding("abc", "a11ce000", "uncited");
    dismiss_finding_in(&state, uncited.clone()).await.unwrap();
    // Twice is once.
    dismiss_finding_in(&state, uncited.clone()).await.unwrap();
    dismiss_finding_in(&state, finding("abc", "a11ce000", "drifted_quote"))
        .await
        .unwrap();
    state.project().await.unwrap().close().await;

    // A restart: a new state over the same folder.
    let state = DbState::default();
    state.open_project(&root).await.unwrap();
    assert_eq!(
        dismissed_findings_in(&state).await.unwrap(),
        vec![uncited.clone(), finding("abc", "a11ce000", "drifted_quote")]
    );

    restore_finding_in(&state, uncited).await.unwrap();
    assert_eq!(
        dismissed_findings_in(&state).await.unwrap(),
        vec![finding("abc", "a11ce000", "drifted_quote")]
    );
}

// M4-7 AC-1
#[tokio::test]
async fn nothing_to_dismiss_into_without_a_project() {
    let state = DbState::default();
    let err = dismissed_findings_in(&state).await.unwrap_err();
    assert_eq!(err.kind, erti_lib::ipc::ErrorKind::Conflict);
}
