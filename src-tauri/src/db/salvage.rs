//! One-time import of metadata from the pre-hybrid database.
//!
//! What this can and cannot do is set by the old schema: `files` recorded a
//! filename and nothing else — no path — so the PDFs it described cannot be
//! located, let alone hashed. The migration therefore carries metadata forward
//! keyed by filename and applies it when a file of that name is next ingested,
//! rather than pretending it can reconstruct sources on its own.
//!
//! The old database is only ever read. It stays on disk untouched, so a user who
//! is unhappy with the result loses nothing.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;
use std::path::Path;
use std::str::FromStr;

#[derive(Debug, serde::Serialize)]
pub struct SalvageReport {
    /// Rows carried forward.
    pub imported: usize,
    /// Rows skipped because their metadata was a `'{}'` placeholder or absent.
    pub skipped_empty: usize,
    /// Files in the old database that were registered but never processed.
    pub skipped_unprocessed: usize,
}

/// Read the legacy database and import whatever metadata genuinely resolved.
///
/// Safe to call repeatedly: filenames already imported are left alone, so this
/// can run on every launch without duplicating or clobbering later corrections.
pub async fn import_legacy_metadata(
    library: &SqlitePool,
    legacy_db: &Path,
) -> Result<SalvageReport, String> {
    if !legacy_db.exists() {
        return Ok(SalvageReport {
            imported: 0,
            skipped_empty: 0,
            skipped_unprocessed: 0,
        });
    }

    // Read-only: this database is not ours to modify or upgrade.
    let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", legacy_db.display()))
        .map_err(|e| e.to_string())?
        .read_only(true);

    let old = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|e| format!("could not open the previous database: {e}"))?;

    let rows = sqlx::query(
        "SELECT f.file_name, sm.metadata
           FROM files f
           LEFT JOIN source_metadata sm ON sm.file_id = f.id",
    )
    .fetch_all(&old)
    .await
    .map_err(|e| format!("could not read the previous database: {e}"))?;

    let mut report = SalvageReport {
        imported: 0,
        skipped_empty: 0,
        skipped_unprocessed: 0,
    };

    for row in rows {
        let file_name: String = row.get("file_name");
        let metadata: Option<String> = row.get("metadata");

        match metadata {
            // No row at all: the file was registered and then never processed,
            // which the old pipeline could not retry. Nothing to carry forward.
            None => report.skipped_unprocessed += 1,
            Some(json) if !is_resolved(&json) => report.skipped_empty += 1,
            Some(json) => {
                sqlx::query(
                    "INSERT INTO legacy_metadata (file_name, csl_json)
                     VALUES (?, ?)
                     ON CONFLICT(file_name) DO NOTHING",
                )
                .bind(&file_name)
                .bind(&json)
                .execute(library)
                .await
                .map_err(|e| e.to_string())?;
                report.imported += 1;
            }
        }
    }

    old.close().await;
    Ok(report)
}

/// Whether stored metadata actually resolved to something citable.
///
/// The old pipeline wrote `'{}'` whenever lookup failed, so presence of a row
/// says nothing. A title is the minimum a citation needs.
fn is_resolved(json: &str) -> bool {
    let trimmed = json.trim();
    if trimmed.is_empty() || trimmed == "{}" {
        return false;
    }

    serde_json::from_str::<serde_json::Value>(trimmed)
        .ok()
        .and_then(|v| {
            v.get("title")
                .map(|t| !t.is_null() && t.as_str().map(|s| !s.trim().is_empty()).unwrap_or(true))
        })
        .unwrap_or(false)
}

/// Metadata previously resolved for this filename, if any.
///
/// Consulted before the network during ingest, so work that already succeeded is
/// not redone.
pub async fn legacy_metadata_for(
    library: &SqlitePool,
    file_name: &str,
) -> Result<Option<String>, String> {
    sqlx::query_scalar("SELECT csl_json FROM legacy_metadata WHERE file_name = ?")
        .bind(file_name)
        .fetch_optional(library)
        .await
        .map_err(|e| e.to_string())
}

/// Note that salvaged metadata has been applied to a real source.
pub async fn mark_legacy_consumed(library: &SqlitePool, file_name: &str) -> Result<(), String> {
    sqlx::query("UPDATE legacy_metadata SET consumed_at = CURRENT_TIMESTAMP WHERE file_name = ?")
        .bind(file_name)
        .execute(library)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_resolved;

    #[test]
    fn placeholder_metadata_is_not_treated_as_resolved() {
        // 23 of the 46 rows in the real database were exactly this.
        assert!(!is_resolved("{}"));
        assert!(!is_resolved("  {}  "));
        assert!(!is_resolved(""));
        assert!(!is_resolved("not json"));
    }

    #[test]
    fn metadata_without_a_usable_title_is_not_resolved() {
        assert!(!is_resolved(r#"{"type":"article-journal"}"#));
        assert!(!is_resolved(r#"{"title":null}"#));
        assert!(!is_resolved(r#"{"title":"   "}"#));
    }

    #[test]
    fn genuinely_resolved_metadata_is_carried_forward() {
        assert!(is_resolved(
            r#"{"title":"Postcolonial cities","type":"article-journal"}"#
        ));
        // A non-string title still counts; normalisation happens downstream.
        assert!(is_resolved(r#"{"title":["Some title"]}"#));
    }
}
