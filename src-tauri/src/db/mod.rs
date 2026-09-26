pub mod backup;
pub mod queries;
pub mod salvage;
pub mod schema;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::SystemTime;
use tokio::sync::RwLock;

/// Open connections: one shared library, plus the project currently open.
///
/// `tauri-plugin-sql` registers migrations against a connection string fixed at
/// build time, which cannot express `<project>/.erti/project.db` — the path is
/// not known until the user opens a folder. Owning the pools here also means
/// every query is a named Rust function, so the frontend never sends SQL and the
/// broad `sql:allow-execute` capability can be dropped.
#[derive(Default)]
pub struct DbState {
    library: RwLock<Option<SqlitePool>>,
    project: RwLock<Option<ProjectHandle>>,
    /// Folders and files the user picked in a dialog this session (M1a-3).
    /// Shared with the fs scope listener registered in `lib.rs`.
    pub grants: std::sync::Arc<crate::scope::Grants>,
    /// The daily backup running in the background, if one was started.
    backup: std::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
}

/// Where a failed backup is reported. It never stops the library opening.
pub type BackupReport = std::sync::Arc<dyn Fn(String) + Send + Sync>;

pub struct ProjectHandle {
    pub pool: SqlitePool,
    pub root: PathBuf,
}

async fn connect(path: &Path) -> Result<SqlitePool, String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| crate::fs_errors::describe(&e, parent))?;
    }

    let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", path.display()))
        .map_err(|e| e.to_string())?
        .create_if_missing(true)
        // WAL keeps ingest writes from blocking reads during a long scan.
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true);

    SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .map_err(|e| format!("could not open {}: {e}", path.display()))
}

/// The schema version a database records, or `None` for a new one.
async fn current_version(pool: &SqlitePool) -> Result<Option<i64>, String> {
    let has_table: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    if has_table.is_none() {
        return Ok(None);
    }
    sqlx::query_scalar("SELECT MAX(version) FROM schema_version")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Bring a database up to `version`, creating it if it is not there yet.
///
/// Every database is built the same way, new ones included: run each migration
/// it has not run yet, in order. There is no separate create-fresh path, so
/// there is nothing for a create-fresh path to drift away from.
///
/// Migrations must be listed in ascending `to` order, and **every migration must
/// be idempotent** — `IF NOT EXISTS` on creates, and a `PRAGMA table_info` check
/// before an `ALTER TABLE ADD COLUMN`, which is not idempotent on its own.
///
/// That requirement carries real weight, because this does not run inside a
/// transaction. Elsewhere they are used freely — `store_chunks` opens one — but
/// those run on a pool already cloned out of `DbState`, so the command's borrow
/// of the managed state has ended. This runs while `open_library` still holds
/// `&DbState`, and a transaction across that await makes the future
/// higher-ranked over the connection lifetime, which `#[tauri::command]` rejects
/// with "Executor is not general enough". So the version row is written only
/// after every step has succeeded, and an upgrade that fails partway leaves the
/// old version recorded and runs again next time.
///
/// Idempotency is what makes that safe, and it covers more than a transaction
/// would have: a transaction prevents a partial apply, but a machine losing
/// power mid-upgrade, or a full disk, still leaves a database that has to be
/// finished on the next open. `migrations_are_idempotent` runs the whole set
/// twice over one database, so a migration that cannot be re-run fails the build
/// rather than someone's library.
///
/// The pool is taken by value and the migrations are `'static`, so this future
/// borrows nothing — another way the command macro's `Send` bound is kept
/// satisfiable.
async fn apply_schema(
    pool: SqlitePool,
    migrations: &'static [schema::Migration],
    version: i64,
) -> Result<(), String> {
    sqlx::query("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let current: Option<i64> = sqlx::query_scalar("SELECT MAX(version) FROM schema_version")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;

    if current == Some(version) {
        return Ok(());
    }

    // A database written by a newer build may contain structures this code does
    // not understand. Opening it read-write risks corrupting a user's library,
    // so fail closed rather than treating it as current.
    if let Some(found) = current {
        if found > version {
            return Err(format!(
                "This library was created by a newer version of Erti (schema {found}, this build understands {version}). Please update Erti."
            ));
        }
    }

    let from = current.unwrap_or(0);

    for migration in migrations.iter().filter(|m| m.to > from && m.to <= version) {
        if migration_is_applied(&pool, migration).await? {
            continue;
        }

        // sqlx's query API is single-statement; these are multi-statement.
        sqlx::raw_sql(migration.sql)
            .execute(&pool)
            .await
            .map_err(|e| format!("migration to schema {} failed: {e}", migration.to))?;
    }

    sqlx::query("INSERT INTO schema_version (version) VALUES (?)")
        .bind(version)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Has this migration already been applied?
///
/// Only migrations that cannot express "if not exists" in their own SQL declare
/// a check — an `ALTER TABLE ADD COLUMN`, which SQLite rejects outright on a
/// duplicate column. Everything else is idempotent on its own and answers false
/// here, which simply means "run it".
async fn migration_is_applied(
    pool: &SqlitePool,
    migration: &schema::Migration,
) -> Result<bool, String> {
    let Some(check) = migration.skip_if else {
        return Ok(false);
    };

    let found: Option<i64> = sqlx::query_scalar(check)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("migration check for schema {} failed: {e}", migration.to))?;

    Ok(found.is_some())
}

impl DbState {
    pub async fn open_library(&self, path: &Path) -> Result<(), String> {
        let report: BackupReport =
            std::sync::Arc::new(|e| log::warn!("Library backup failed: {e}"));
        self.open_library_reporting(path, report).await
    }

    /// Open the library, backing it up first if it is about to be migrated,
    /// and starting a daily backup if one is due (ADR 008).
    ///
    /// A failed backup goes to `report` and the library opens anyway: losing
    /// the app to a full backup disk would be worse than a missed copy.
    pub async fn open_library_reporting(
        &self,
        path: &Path,
        report: BackupReport,
    ) -> Result<(), String> {
        let pool = connect(path).await?;
        let backups = backup::dir_for(path);

        // Unconditionally before an upgrade, and awaited: this copy is the way
        // back if the migration goes wrong. A new library has nothing to keep.
        let existing = current_version(&pool).await?;
        if let Some(from) = existing.filter(|&v| v < schema::LIBRARY_VERSION) {
            if let Err(e) = backup::write(&pool, &backups, SystemTime::now(), Some(from)).await {
                report(e);
            }
        }

        apply_schema(
            pool.clone(),
            schema::LIBRARY_MIGRATIONS,
            schema::LIBRARY_VERSION,
        )
        .await?;

        // Off the command's path: `VACUUM INTO` on a large library takes
        // seconds, and opening shouldn't wait for it.
        if existing.is_some() && backup::daily_due(&backups, SystemTime::now()) {
            let pool = pool.clone();
            let task = tokio::spawn(async move {
                if let Err(e) = backup::write(&pool, &backups, SystemTime::now(), None).await {
                    report(e);
                }
            });
            *self.backup.lock().unwrap_or_else(|e| e.into_inner()) = Some(task);
        }

        *self.library.write().await = Some(pool);
        Ok(())
    }

    /// Wait for a background backup to finish. For tests, and for closing.
    pub async fn backups_settled(&self) {
        let task = self.backup.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(task) = task {
            let _ = task.await;
        }
    }

    /// Open `<root>/.erti/project.db`, creating it on first use.
    pub async fn open_project(&self, root: &Path) -> Result<(), String> {
        let pool = connect(&root.join(".erti").join("project.db")).await?;
        apply_schema(
            pool.clone(),
            schema::PROJECT_MIGRATIONS,
            schema::PROJECT_VERSION,
        )
        .await?;

        *self.project.write().await = Some(ProjectHandle {
            pool,
            root: root.to_path_buf(),
        });
        Ok(())
    }

    /// The open library. Not being open yet is a state, not a failure of the
    /// database, so it is a `Conflict` (ADR 011).
    pub async fn library(&self) -> Result<SqlitePool, crate::ipc::AppError> {
        self.library.read().await.clone().ok_or_else(|| {
            crate::ipc::AppError::new(
                crate::ipc::ErrorKind::Conflict,
                "The library isn't open yet.",
            )
        })
    }

    pub async fn project(&self) -> Result<SqlitePool, crate::ipc::AppError> {
        self.project
            .read()
            .await
            .as_ref()
            .map(|p| p.pool.clone())
            .ok_or_else(no_project)
    }

    pub async fn project_root(&self) -> Result<PathBuf, crate::ipc::AppError> {
        self.project
            .read()
            .await
            .as_ref()
            .map(|p| p.root.clone())
            .ok_or_else(no_project)
    }
}

fn no_project() -> crate::ipc::AppError {
    crate::ipc::AppError::new(crate::ipc::ErrorKind::Conflict, "No project is open.")
}

/// SHA-256 of a file's contents, streamed so large PDFs never land in memory whole.
///
/// This is a source's identity. Hashing contents rather than trusting a filename
/// is what lets the same paper live in two project folders as one entry, and
/// what stops two different papers sharing a name from colliding.
pub async fn hash_file(path: &Path) -> Result<String, crate::ipc::AppError> {
    use sha2::{Digest, Sha256};
    use tokio::io::AsyncReadExt;

    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| crate::ipc::AppError::from_io(&e, path))?;

    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buf)
            .await
            .map_err(|e| crate::ipc::AppError::from_io(&e, path))?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

/// Pack embeddings as little-endian f32.
///
/// The previous pipeline stored `JSON.stringify(embedding)` into a column
/// declared BLOB: 4702 bytes measured per 384-dim vector against 1536 packed,
/// and a JSON.parse per chunk on every search.
pub fn pack_embedding(values: &[f32]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}

pub fn unpack_embedding(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embeddings_round_trip_through_the_blob_encoding() {
        let original = vec![0.0f32, 1.0, -1.5, 2.71875, f32::MIN, f32::MAX];
        let packed = pack_embedding(&original);

        assert_eq!(packed.len(), original.len() * 4, "4 bytes per f32");
        assert_eq!(unpack_embedding(&packed), original);
    }

    #[test]
    fn packed_form_is_much_smaller_than_json() {
        // Measured on the previous schema, real 384-dim MiniLM vectors averaged
        // 4702 bytes as JSON text against 1536 packed — 3.1x, and embeddings were
        // 96% of the stored payload. The exact ratio here depends on how many
        // digits each float needs, so this asserts the order of magnitude rather
        // than a figure tied to one synthetic literal.
        let vector = vec![-0.041_658_9_f32; 384];

        let packed = pack_embedding(&vector).len();
        let as_json = serde_json::to_string(&vector).unwrap().len();

        assert_eq!(packed, 384 * 4, "exactly 4 bytes per dimension");
        assert!(
            as_json > packed * 2,
            "JSON was {as_json} bytes against {packed} packed"
        );
    }

    #[test]
    fn unpacking_ignores_a_trailing_partial_float() {
        assert_eq!(unpack_embedding(&[0, 0, 128, 63, 1, 2]), vec![1.0f32]);
    }
}
