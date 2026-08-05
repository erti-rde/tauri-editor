pub mod queries;
pub mod salvage;
pub mod schema;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::path::{Path, PathBuf};
use std::str::FromStr;
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
}

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

/// Apply a schema and record its version.
///
/// The schemas are written with `IF NOT EXISTS`, so this is safe to re-run. The
/// version table is what a future migration will branch on.
async fn apply_schema(pool: &SqlitePool, sql: &str, version: i64) -> Result<(), String> {
    sqlx::query("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    let current: Option<i64> = sqlx::query_scalar("SELECT MAX(version) FROM schema_version")
        .fetch_one(pool)
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

    // sqlx's query API is single-statement; the schemas are multi-statement.
    sqlx::raw_sql(sql)
        .execute(pool)
        .await
        .map_err(|e| format!("schema failed: {e}"))?;

    sqlx::query("INSERT INTO schema_version (version) VALUES (?)")
        .bind(version)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

impl DbState {
    pub async fn open_library(&self, path: &Path) -> Result<(), String> {
        let pool = connect(path).await?;
        apply_schema(&pool, schema::LIBRARY_SCHEMA, schema::LIBRARY_VERSION).await?;
        *self.library.write().await = Some(pool);
        Ok(())
    }

    /// Open `<root>/.erti/project.db`, creating it on first use.
    pub async fn open_project(&self, root: &Path) -> Result<(), String> {
        let pool = connect(&root.join(".erti").join("project.db")).await?;
        apply_schema(&pool, schema::PROJECT_SCHEMA, schema::PROJECT_VERSION).await?;

        *self.project.write().await = Some(ProjectHandle {
            pool,
            root: root.to_path_buf(),
        });
        Ok(())
    }

    pub async fn library(&self) -> Result<SqlitePool, String> {
        self.library
            .read()
            .await
            .clone()
            .ok_or_else(|| "library is not open".to_string())
    }

    pub async fn project(&self) -> Result<SqlitePool, String> {
        self.project
            .read()
            .await
            .as_ref()
            .map(|p| p.pool.clone())
            .ok_or_else(|| "no project is open".to_string())
    }

    pub async fn project_root(&self) -> Result<PathBuf, String> {
        self.project
            .read()
            .await
            .as_ref()
            .map(|p| p.root.clone())
            .ok_or_else(|| "no project is open".to_string())
    }
}

/// SHA-256 of a file's contents, streamed so large PDFs never land in memory whole.
///
/// This is a source's identity. Hashing contents rather than trusting a filename
/// is what lets the same paper live in two project folders as one entry, and
/// what stops two different papers sharing a name from colliding.
pub async fn hash_file(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use tokio::io::AsyncReadExt;

    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| crate::fs_errors::describe(&e, path))?;

    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buf).await.map_err(|e| e.to_string())?;
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
