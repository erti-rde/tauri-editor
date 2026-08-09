//! Named queries.
//!
//! Every statement the app runs lives here. Nothing accepts SQL from the
//! frontend, which is what allows `sql:allow-execute` to be dropped from the
//! app's capabilities.
//!
//! The library and the project are separate databases, so "sources in this
//! project" is two reads joined in Rust rather than a SQL join. That keeps the
//! project folder portable — its database references library sources by hash and
//! carries no copy of them.

use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqlitePool;
use sqlx::Row;

use super::{pack_embedding, unpack_embedding};

#[derive(Debug, Serialize, Deserialize)]
pub struct Source {
    pub sha256: String,
    pub file_name: String,
    pub path: Option<String>,
    /// CSL-JSON, with any project-local override already applied.
    pub csl_json: Option<String>,
    pub zotero_type: Option<String>,
    pub doi: Option<String>,
    pub resolved_via: Option<String>,
    pub state: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NewChunk {
    pub text: String,
    pub embedding: Vec<f32>,
    pub page_start: Option<i64>,
    pub page_end: Option<i64>,
    pub section: Option<String>,
    pub char_start: Option<i64>,
    pub char_end: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScoredChunk {
    pub sha256: String,
    /// Position of the chunk within its source. `(sha256, idx)` is the chunk's
    /// primary key, and the only stable identity a result has — two chunks from
    /// one PDF share a hash.
    pub idx: i64,
    pub text: String,
    pub page_start: Option<i64>,
    pub section: Option<String>,
    pub similarity: f32,
    /// False when the chunk comes from outside the current project's source set.
    pub in_project: bool,
}

/// Record a source and where it was found.
///
/// Idempotent by hash: re-scanning a folder, or finding the same PDF in a second
/// project, updates the location rather than creating a duplicate or failing the
/// way the old `file_name UNIQUE` column did.
pub async fn register_source(
    pool: &SqlitePool,
    sha256: &str,
    path: &str,
    file_name: &str,
) -> Result<bool, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let inserted = sqlx::query("INSERT OR IGNORE INTO sources (sha256) VALUES (?)")
        .bind(sha256)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?
        .rows_affected()
        > 0;

    sqlx::query(
        "INSERT INTO locations (sha256, path, file_name, last_seen)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(sha256, path) DO UPDATE SET last_seen = CURRENT_TIMESTAMP",
    )
    .bind(sha256)
    .bind(path)
    .bind(file_name)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    if inserted {
        sqlx::query("INSERT OR IGNORE INTO ingest_status (sha256, state) VALUES (?, 'pending')")
            .bind(sha256)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(inserted)
}

/// Hashes that still need text extraction and embedding.
///
/// Driven by ingest state, not by presence in a table, so a source that failed
/// is offered again instead of being silently skipped forever.
pub async fn sources_needing_ingest(pool: &SqlitePool) -> Result<Vec<String>, String> {
    sqlx::query_scalar(
        "SELECT sha256 FROM ingest_status WHERE state IN ('pending', 'failed') ORDER BY attempts, sha256",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

/// Replace a source's chunks and mark it ready, in one transaction.
///
/// Chunks and status move together: a partially written source can never be
/// left looking complete.
pub async fn store_chunks(
    pool: &SqlitePool,
    sha256: &str,
    chunks: &[NewChunk],
) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM chunks WHERE sha256 = ?")
        .bind(sha256)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    for (idx, chunk) in chunks.iter().enumerate() {
        sqlx::query(
            "INSERT INTO chunks
               (sha256, idx, text, page_start, page_end, section, char_start, char_end, embedding)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(sha256)
        .bind(idx as i64)
        .bind(&chunk.text)
        .bind(chunk.page_start)
        .bind(chunk.page_end)
        .bind(&chunk.section)
        .bind(chunk.char_start)
        .bind(chunk.char_end)
        .bind(pack_embedding(&chunk.embedding))
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    sqlx::query(
        "UPDATE ingest_status
            SET state = 'ready', last_error = NULL, last_attempt = CURRENT_TIMESTAMP
          WHERE sha256 = ?",
    )
    .bind(sha256)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())
}

/// Record a failed ingest so it stays visible and retryable.
pub async fn mark_ingest_failed(
    pool: &SqlitePool,
    sha256: &str,
    error: &str,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE ingest_status
            SET state = 'failed',
                attempts = attempts + 1,
                last_error = ?,
                last_attempt = CURRENT_TIMESTAMP
          WHERE sha256 = ?",
    )
    .bind(error)
    .bind(sha256)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn set_source_metadata(
    pool: &SqlitePool,
    sha256: &str,
    csl_json: &str,
    zotero_type: Option<&str>,
    doi: Option<&str>,
    resolved_via: &str,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE sources
            SET csl_json = ?, zotero_type = ?, doi = ?,
                resolved_via = ?, resolved_at = CURRENT_TIMESTAMP
          WHERE sha256 = ?",
    )
    .bind(csl_json)
    .bind(zotero_type)
    .bind(doi)
    .bind(resolved_via)
    .bind(sha256)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn project_source_hashes(project: &SqlitePool) -> Result<Vec<String>, String> {
    sqlx::query_scalar("SELECT sha256 FROM source_set ORDER BY added_at")
        .fetch_all(project)
        .await
        .map_err(|e| e.to_string())
}

pub async fn add_to_project(project: &SqlitePool, sha256: &str) -> Result<(), String> {
    sqlx::query("INSERT OR IGNORE INTO source_set (sha256) VALUES (?)")
        .bind(sha256)
        .execute(project)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Sources belonging to the open project, with project-local metadata
/// overrides applied on top of the library's copy.
pub async fn project_sources(
    library: &SqlitePool,
    project: &SqlitePool,
) -> Result<Vec<Source>, String> {
    let hashes = project_source_hashes(project).await?;
    if hashes.is_empty() {
        return Ok(Vec::new());
    }

    let overrides: std::collections::HashMap<String, String> =
        sqlx::query("SELECT sha256, csl_json FROM metadata_overrides")
            .fetch_all(project)
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|r| (r.get::<String, _>("sha256"), r.get::<String, _>("csl_json")))
            .collect();

    let placeholders = std::iter::repeat_n("?", hashes.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT s.sha256, s.csl_json, s.zotero_type, s.doi, s.resolved_via,
                COALESCE(i.state, 'pending') AS state, i.last_error,
                (SELECT file_name FROM locations l WHERE l.sha256 = s.sha256
                  ORDER BY last_seen DESC LIMIT 1) AS file_name,
                (SELECT path FROM locations l WHERE l.sha256 = s.sha256
                  ORDER BY last_seen DESC LIMIT 1) AS path
           FROM sources s
           LEFT JOIN ingest_status i ON i.sha256 = s.sha256
          WHERE s.sha256 IN ({placeholders})"
    );

    let mut query = sqlx::query(&sql);
    for hash in &hashes {
        query = query.bind(hash);
    }

    Ok(query
        .fetch_all(library)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|r| {
            let sha256: String = r.get("sha256");
            let csl_json = overrides
                .get(&sha256)
                .cloned()
                .or_else(|| r.get("csl_json"));
            Source {
                file_name: r.try_get("file_name").unwrap_or_default(),
                path: r.get("path"),
                csl_json,
                zotero_type: r.get("zotero_type"),
                doi: r.get("doi"),
                resolved_via: r.get("resolved_via"),
                state: r.get("state"),
                last_error: r.get("last_error"),
                sha256,
            }
        })
        .collect())
}

pub async fn set_metadata_override(
    project: &SqlitePool,
    sha256: &str,
    csl_json: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO metadata_overrides (sha256, csl_json, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(sha256) DO UPDATE SET csl_json = excluded.csl_json, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(sha256)
    .bind(csl_json)
    .execute(project)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Rank chunks against a query vector.
///
/// Scoring happens here rather than in the webview: the old implementation
/// selected every chunk and embedding, sent them across the IPC boundary, and
/// ran cosine in JS on the main thread. Only the top results cross now.
///
/// Results carry `in_project` so the UI can list the project's own sources first
/// while keeping the rest of the library one click away.
pub async fn search_similar(
    library: &SqlitePool,
    query_embedding: &[f32],
    project_hashes: &[String],
    limit: usize,
    include_library: bool,
) -> Result<Vec<ScoredChunk>, String> {
    let rows = sqlx::query("SELECT sha256, idx, text, page_start, section, embedding FROM chunks")
        .fetch_all(library)
        .await
        .map_err(|e| e.to_string())?;

    let in_set: std::collections::HashSet<&str> =
        project_hashes.iter().map(|s| s.as_str()).collect();

    let mut scored: Vec<ScoredChunk> = rows
        .into_iter()
        .filter_map(|r| {
            let sha256: String = r.get("sha256");
            let in_project = in_set.contains(sha256.as_str());
            if !in_project && !include_library {
                return None;
            }

            let embedding = unpack_embedding(&r.get::<Vec<u8>, _>("embedding"));
            Some(ScoredChunk {
                similarity: crate::commands::cosine_similarity(query_embedding, &embedding),
                idx: r.get("idx"),
                text: r.get("text"),
                page_start: r.get("page_start"),
                section: r.get("section"),
                sha256,
                in_project,
            })
        })
        .collect();

    scored.sort_by(|a, b| {
        // Project sources first, then by similarity.
        b.in_project.cmp(&a.in_project).then(
            b.similarity
                .partial_cmp(&a.similarity)
                .unwrap_or(std::cmp::Ordering::Equal),
        )
    });
    scored.truncate(limit);

    Ok(scored)
}

pub async fn set_embedding_meta(
    pool: &SqlitePool,
    model_id: &str,
    dims: i64,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO embedding_meta (id, model_id, dims, updated_at)
         VALUES (1, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET model_id = excluded.model_id,
                                       dims = excluded.dims,
                                       updated_at = CURRENT_TIMESTAMP",
    )
    .bind(model_id)
    .bind(dims)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// The model that produced the stored vectors, if any are stored yet.
pub async fn embedding_meta(pool: &SqlitePool) -> Result<Option<(String, i64)>, String> {
    let row = sqlx::query("SELECT model_id, dims FROM embedding_meta WHERE id = 1")
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(row.map(|r| (r.get("model_id"), r.get("dims"))))
}
