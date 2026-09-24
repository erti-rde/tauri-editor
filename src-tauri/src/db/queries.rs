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

#[derive(Debug, Serialize, Deserialize, specta::Type)]
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

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct NewChunk {
    pub text: String,
    pub embedding: Vec<f32>,
    #[specta(optional)]
    #[specta(type = Option<specta_typescript::Number>)]
    pub page_start: Option<i64>,
    #[specta(optional)]
    #[specta(type = Option<specta_typescript::Number>)]
    pub page_end: Option<i64>,
    #[specta(optional)]
    pub section: Option<String>,
    #[specta(optional)]
    #[specta(type = Option<specta_typescript::Number>)]
    pub char_start: Option<i64>,
    #[specta(optional)]
    #[specta(type = Option<specta_typescript::Number>)]
    pub char_end: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct ScoredChunk {
    pub sha256: String,
    /// Position of the chunk within its source. `(sha256, idx)` is the chunk's
    /// primary key, and the only stable identity a result has — two chunks from
    /// one PDF share a hash.
    #[specta(type = specta_typescript::Number)]
    pub idx: i64,
    pub text: String,
    #[specta(type = Option<specta_typescript::Number>)]
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
/// Which model produced the stored vectors.
#[derive(Debug, Serialize, specta::Type)]
pub struct EmbeddingMeta {
    pub model_id: String,
    #[specta(type = specta_typescript::Number)]
    pub dims: i64,
}

pub async fn embedding_meta(pool: &SqlitePool) -> Result<Option<(String, i64)>, String> {
    let row = sqlx::query("SELECT model_id, dims FROM embedding_meta WHERE id = 1")
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(row.map(|r| (r.get("model_id"), r.get("dims"))))
}

/* ------------------------------------------------------------- annotations */

/// A reading mark: a highlight, an area snapshot, or a note pinned to a page.
///
/// Anchored twice over. `rects` draws it immediately and survives zoom, because
/// it is stored in PDF user space rather than screen pixels. `quote` with the
/// text either side finds it again when the geometry stops agreeing, and is
/// also what makes the passage searchable rather than merely positioned.
#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct Annotation {
    pub id: String,
    pub sha256: String,
    /// 'highlight' | 'area' | 'page-note'
    pub kind: String,
    pub label_id: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub page: i64,
    /// JSON array of `{x, y, w, h}` in PDF user space; None for a page note.
    pub rects: Option<String>,
    pub quote: Option<String>,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub char_start: Option<i64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub char_end: Option<i64>,
    pub note: Option<String>,
    /// 'fill' | 'underline' — how the mark is drawn, not what it means.
    pub style: String,
    /// The page number the paper itself prints, when it differs from the sheet.
    pub page_label: Option<String>,
    /// 'erti' | 'imported' — so highlights brought in from Zotero or Preview
    /// can be told apart, and undone in one action.
    pub origin: String,
    pub created_at: String,
    pub updated_at: String,
}

/// An annotation on its way in. The id is chosen by the caller so the same
/// record keeps its identity through an export and back.
#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct NewAnnotation {
    pub id: String,
    pub sha256: String,
    pub kind: String,
    #[specta(optional)]
    pub label_id: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub page: i64,
    #[specta(optional)]
    pub rects: Option<String>,
    #[specta(optional)]
    pub quote: Option<String>,
    #[specta(optional)]
    pub prefix: Option<String>,
    #[specta(optional)]
    pub suffix: Option<String>,
    #[specta(optional)]
    #[specta(type = Option<specta_typescript::Number>)]
    pub char_start: Option<i64>,
    #[specta(optional)]
    #[specta(type = Option<specta_typescript::Number>)]
    pub char_end: Option<i64>,
    #[specta(optional)]
    pub note: Option<String>,
    #[specta(optional)]
    pub style: Option<String>,
    #[specta(optional)]
    pub page_label: Option<String>,
    #[specta(optional)]
    pub origin: Option<String>,
}

fn annotation_from(row: &sqlx::sqlite::SqliteRow) -> Annotation {
    Annotation {
        id: row.get("id"),
        sha256: row.get("sha256"),
        kind: row.get("kind"),
        label_id: row.get("label_id"),
        page: row.get("page"),
        rects: row.get("rects"),
        quote: row.get("quote"),
        prefix: row.get("prefix"),
        suffix: row.get("suffix"),
        char_start: row.get("char_start"),
        char_end: row.get("char_end"),
        note: row.get("note"),
        style: row.get("style"),
        page_label: row.get("page_label"),
        origin: row.get("origin"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

const ANNOTATION_COLUMNS: &str = "id, sha256, kind, label_id, page, rects, quote, prefix, suffix,
     char_start, char_end, note, style, page_label, origin, created_at, updated_at";

/// Save an annotation, or replace one that already exists.
///
/// Upsert rather than insert because the same record arrives again on re-import
/// from a sidecar, and because editing a note is the common case: writing it as
/// a delete and an insert would lose `created_at` and change what "my oldest
/// note on this paper" means.
pub async fn save_annotation(pool: &SqlitePool, annotation: &NewAnnotation) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO annotations
           (id, sha256, kind, label_id, page, rects, quote, prefix, suffix,
            char_start, char_end, note, style, page_label, origin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'fill'), ?, COALESCE(?, 'erti'))
         ON CONFLICT(id) DO UPDATE SET
            label_id   = excluded.label_id,
            rects      = excluded.rects,
            quote      = excluded.quote,
            prefix     = excluded.prefix,
            suffix     = excluded.suffix,
            char_start = excluded.char_start,
            char_end   = excluded.char_end,
            note       = excluded.note,
            style      = excluded.style,
            page_label = excluded.page_label,
            updated_at = CURRENT_TIMESTAMP",
    )
    .bind(&annotation.id)
    .bind(&annotation.sha256)
    .bind(&annotation.kind)
    .bind(&annotation.label_id)
    .bind(annotation.page)
    .bind(&annotation.rects)
    .bind(&annotation.quote)
    .bind(&annotation.prefix)
    .bind(&annotation.suffix)
    .bind(annotation.char_start)
    .bind(annotation.char_end)
    .bind(&annotation.note)
    .bind(&annotation.style)
    .bind(&annotation.page_label)
    .bind(&annotation.origin)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Everything marked on one paper, in the order it would be read.
pub async fn annotations_for_source(
    pool: &SqlitePool,
    sha256: &str,
) -> Result<Vec<Annotation>, String> {
    let rows = sqlx::query(&format!(
        "SELECT {ANNOTATION_COLUMNS} FROM annotations
          WHERE sha256 = ? ORDER BY page, created_at"
    ))
    .bind(sha256)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(annotation_from).collect())
}

/// Every annotation in the library, newest first.
///
/// The notes panel pages through this. A researcher has hundreds, not millions,
/// so a limit and an offset are enough and there is no index to maintain.
pub async fn all_annotations(
    pool: &SqlitePool,
    limit: i64,
    offset: i64,
) -> Result<Vec<Annotation>, String> {
    let rows = sqlx::query(&format!(
        "SELECT {ANNOTATION_COLUMNS} FROM annotations
          ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ))
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(annotation_from).collect())
}

pub async fn delete_annotation(pool: &SqlitePool, id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM annotations WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Drop every annotation brought in from another tool for this paper.
///
/// Importing is offered rather than silent, and this is the other half of that
/// bargain: a researcher who does not like the result gets it undone in one
/// action, without touching anything they marked themselves.
pub async fn delete_imported_annotations(pool: &SqlitePool, sha256: &str) -> Result<u64, String> {
    let result = sqlx::query("DELETE FROM annotations WHERE sha256 = ? AND origin = 'imported'")
        .bind(sha256)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(result.rows_affected())
}

/// What a highlight colour means.
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct AnnotationLabel {
    pub id: String,
    pub name: String,
    /// `H S% L%`, matching the theme tokens rather than a hex string, so a
    /// label sits in the same colour system as the rest of the interface.
    pub colour: String,
    #[specta(type = specta_typescript::Number)]
    pub position: i64,
    pub enabled: bool,
}

/// The labels a new library starts with, as a reference for the interface.
///
/// The rows themselves are created by the version 3 migration, which is the one
/// place they are inserted — seeding on every open would restore a label the
/// researcher had deliberately deleted. `defaults_match_the_migration` keeps
/// this list and that SQL from drifting apart.
///
/// Six describe what a passage *is* — the moves a paper actually makes — and two
/// describe what the reader thinks of it. `Interesting` is the one that is
/// neither: it marks something worth coming back to rather than something being
/// argued, which is how most future work starts.
///
/// `My opinion` is deliberately grey rather than a ninth hue. It is the only
/// label that is not about the paper, and keeping the reader's own voice
/// desaturated, not competing with the six content colours, makes that
/// difference legible at a glance.
///
/// Colour is never the only channel: eight hues is past what stays separable
/// under deuteranopia, so the name travels with the annotation everywhere it is
/// shown. All eight are editable and removable; this is only what is there
/// before anyone chooses otherwise.
pub const DEFAULT_LABELS: &[(&str, &str, &str)] = &[
    ("claim", "Claim", "45 95% 62%"),
    ("evidence", "Evidence", "145 50% 55%"),
    ("method", "Method", "210 80% 65%"),
    ("limitation", "Limitation", "5 80% 66%"),
    ("definition", "Definition", "185 55% 52%"),
    ("counter-point", "Counter-point", "280 50% 68%"),
    ("interesting", "Interesting", "325 70% 68%"),
    ("my-opinion", "My opinion", "220 12% 62%"),
];

pub async fn annotation_labels(pool: &SqlitePool) -> Result<Vec<AnnotationLabel>, String> {
    let rows = sqlx::query(
        "SELECT id, name, colour, position, enabled FROM annotation_labels ORDER BY position",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|row| AnnotationLabel {
            id: row.get("id"),
            name: row.get("name"),
            colour: row.get("colour"),
            position: row.get("position"),
            enabled: row.get::<i64, _>("enabled") != 0,
        })
        .collect())
}

/// Rename, recolour, reorder, or switch a label off.
pub async fn save_label(pool: &SqlitePool, label: &AnnotationLabel) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO annotation_labels (id, name, colour, position, enabled)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name, colour = excluded.colour,
            position = excluded.position, enabled = excluded.enabled",
    )
    .bind(&label.id)
    .bind(&label.name)
    .bind(&label.colour)
    .bind(label.position)
    .bind(i64::from(label.enabled))
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Remove a label, leaving the highlights that used it in place.
///
/// The mark was a real judgement about the passage; deleting the colour it was
/// filed under is not a reason to lose it. They become unlabelled and can be
/// filed again.
pub async fn delete_label(pool: &SqlitePool, id: &str) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query("UPDATE annotations SET label_id = NULL WHERE label_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM annotation_labels WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())
}

/// Remember where reading stopped, keyed by the paper rather than the tab.
pub async fn save_reading_position(
    pool: &SqlitePool,
    sha256: &str,
    page: i64,
    scroll: Option<f64>,
    scale: Option<&str>,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO reading_positions (sha256, page, scroll, scale, seen_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(sha256) DO UPDATE SET
            page = excluded.page, scroll = excluded.scroll,
            scale = excluded.scale, seen_at = CURRENT_TIMESTAMP",
    )
    .bind(sha256)
    .bind(page)
    .bind(scroll)
    .bind(scale)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub async fn reading_position(pool: &SqlitePool, sha256: &str) -> Result<Option<i64>, String> {
    sqlx::query_scalar("SELECT page FROM reading_positions WHERE sha256 = ?")
        .bind(sha256)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())
}

/// The path a source was last seen at, for opening the file.
///
/// The library records where a hash has been seen rather than owning a copy, so
/// this can be absent or stale — that is the model working as intended, and the
/// caller says so rather than failing.
pub async fn path_for_source(pool: &SqlitePool, sha256: &str) -> Result<Option<String>, String> {
    sqlx::query_scalar(
        "SELECT path FROM locations WHERE sha256 = ? ORDER BY last_seen DESC LIMIT 1",
    )
    .bind(sha256)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())
}

/// Which source, if any, a file on disk is.
pub async fn source_for_path(pool: &SqlitePool, path: &str) -> Result<Option<String>, String> {
    sqlx::query_scalar("SELECT sha256 FROM locations WHERE path = ? LIMIT 1")
        .bind(path)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Keep the cropped picture for an area snapshot.
pub async fn save_annotation_image(pool: &SqlitePool, id: &str, png: &[u8]) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO annotation_images (id, png) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET png = excluded.png",
    )
    .bind(id)
    .bind(png)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub async fn annotation_image(pool: &SqlitePool, id: &str) -> Result<Option<Vec<u8>>, String> {
    sqlx::query_scalar("SELECT png FROM annotation_images WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Store the vector for a mark, with the hash of the text it came from.
///
/// The hash is what stops an unchanged note being embedded again every time the
/// mark is touched — recolouring a highlight should not cost an inference.
pub async fn save_annotation_embedding(
    pool: &SqlitePool,
    id: &str,
    embedding: &[f32],
    text_hash: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO annotation_embeddings (id, embedding, text_hash) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            embedding = excluded.embedding, text_hash = excluded.text_hash",
    )
    .bind(id)
    .bind(pack_embedding(embedding))
    .bind(text_hash)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// The hash of the text a mark was last embedded from, if it ever was.
/// Marks that carry no vector, and the text that would give them one.
///
/// A mark is embedded when it is made, and that can fail — a library that is not
/// open yet, a model that has not loaded, a save that raced a project switch.
/// Failing is survivable and is not made loud, because a highlight must never be
/// lost to it; but the mark is then absent from every search by meaning, and
/// silently. This is what finds them again.
///
/// The joined text matches what `embedAnnotation` sends, so a backfilled mark
/// and a freshly made one are embedded identically.
pub async fn annotations_needing_embedding(
    pool: &SqlitePool,
    limit: i64,
) -> Result<Vec<(String, String)>, String> {
    let rows = sqlx::query(
        "SELECT a.id,
                TRIM(COALESCE(a.quote, '') ||
                     CASE WHEN a.quote IS NOT NULL AND TRIM(COALESCE(a.note, '')) != ''
                          THEN ' \u{2014} ' ELSE '' END ||
                     COALESCE(a.note, '')) AS text
           FROM annotations a
           LEFT JOIN annotation_embeddings e ON e.id = a.id
          WHERE e.id IS NULL
            AND TRIM(COALESCE(a.quote, '') || COALESCE(a.note, '')) != ''
          ORDER BY a.created_at
          LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|row| (row.get::<String, _>("id"), row.get::<String, _>("text")))
        .collect())
}

pub async fn annotation_embedding_hash(
    pool: &SqlitePool,
    id: &str,
) -> Result<Option<String>, String> {
    sqlx::query_scalar("SELECT text_hash FROM annotation_embeddings WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())
}

/// A mark, ranked against something the researcher is looking for.
#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct ScoredAnnotation {
    #[serde(flatten)]
    pub annotation: Annotation,
    /// Cosine similarity for a semantic search; 1.0 for a literal match.
    pub similarity: f32,
    /// False when the mark is on a paper outside the open project's source set.
    pub in_project: bool,
    /// The paper's filename, so a result can name where it came from.
    pub file_name: Option<String>,
}

fn scored_from(
    row: &sqlx::sqlite::SqliteRow,
    similarity: f32,
    in_project: bool,
) -> ScoredAnnotation {
    ScoredAnnotation {
        annotation: annotation_from(row),
        similarity,
        in_project,
        file_name: row.try_get("file_name").ok(),
    }
}

/// The columns every annotation search reads, with the paper's name alongside.
///
/// `locations` can hold several paths for one hash, so the name is taken from
/// the most recently seen one rather than joined blindly, which would multiply
/// a mark by the number of folders its paper has been found in.
const ANNOTATION_SEARCH_SELECT: &str = "SELECT a.id, a.sha256, a.kind, a.label_id, a.page, a.rects,
            a.quote, a.prefix, a.suffix, a.char_start, a.char_end, a.note, a.style, a.page_label,
            a.origin, a.created_at, a.updated_at,
            (SELECT l.file_name FROM locations l WHERE l.sha256 = a.sha256
              ORDER BY l.last_seen DESC LIMIT 1) AS file_name
       FROM annotations a";

/// The same columns, plus the vector, for the semantic search.
const ANNOTATION_SEARCH_WITH_EMBEDDING: &str = "SELECT a.id, a.sha256, a.kind, a.label_id, a.page,
            a.rects, a.quote, a.prefix, a.suffix, a.char_start, a.char_end, a.note, a.style,
            a.page_label, a.origin, a.created_at, a.updated_at, e.embedding,
            (SELECT l.file_name FROM locations l WHERE l.sha256 = a.sha256
              ORDER BY l.last_seen DESC LIMIT 1) AS file_name
       FROM annotations a
       JOIN annotation_embeddings e ON e.id = a.id";

/// Find marks by the words in them.
///
/// `LIKE` rather than FTS5, deliberately. There is no full-text index anywhere
/// in this database, and adding one means a virtual table plus triggers to keep
/// it honest. A researcher has hundreds of marks, not millions; scanning them is
/// microseconds. FTS5 is the answer if that ever stops being true, and measuring
/// is how we would know.
pub async fn search_annotations_literally(
    pool: &SqlitePool,
    query: &str,
    project_hashes: &[String],
    limit: i64,
) -> Result<Vec<ScoredAnnotation>, String> {
    let pattern = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));

    let rows = sqlx::query(&format!(
        "{ANNOTATION_SEARCH_SELECT}
          WHERE a.quote LIKE ?1 ESCAPE '\\' OR a.note LIKE ?1 ESCAPE '\\'
          ORDER BY a.created_at DESC
          LIMIT ?2"
    ))
    .bind(&pattern)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let in_set: std::collections::HashSet<&str> =
        project_hashes.iter().map(|s| s.as_str()).collect();

    Ok(rows
        .iter()
        .map(|row| {
            let sha256: String = row.get("sha256");
            let in_project = in_set.contains(sha256.as_str());
            scored_from(row, 1.0, in_project)
        })
        .collect())
}

/// Find marks by what they are about.
///
/// Scored in Rust over the whole set, the same way `search_similar` handles
/// chunks: a mark's vector has no reason to cross the IPC boundary when only the
/// ranking is wanted on the other side.
pub async fn search_annotations_semantically(
    pool: &SqlitePool,
    query_embedding: &[f32],
    project_hashes: &[String],
    limit: usize,
) -> Result<Vec<ScoredAnnotation>, String> {
    // One query, joined: the mark and its vector come back together rather than
    // being fetched separately and stitched by id.
    let rows = sqlx::query(ANNOTATION_SEARCH_WITH_EMBEDDING)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let in_set: std::collections::HashSet<&str> =
        project_hashes.iter().map(|s| s.as_str()).collect();

    let mut scored: Vec<ScoredAnnotation> = rows
        .iter()
        .map(|row| {
            let vector = unpack_embedding(row.get::<Vec<u8>, _>("embedding").as_slice());

            let sha256: String = row.get("sha256");
            let in_project = in_set.contains(sha256.as_str());

            scored_from(
                row,
                crate::commands::cosine_similarity(query_embedding, &vector),
                in_project,
            )
        })
        .collect();

    // Project first, then by similarity — the same ordering the chunk search
    // uses, so the two surfaces behave alike.
    scored.sort_by(|a, b| {
        b.in_project
            .cmp(&a.in_project)
            .then(b.similarity.total_cmp(&a.similarity))
    });
    scored.truncate(limit);

    Ok(scored)
}

/// What a reader would call a colour, from its hue.
///
/// For the researcher who does not want Erti's opinion about what their
/// highlights mean. Naming a colour after itself is a real answer, not a
/// failure to have one — plenty of people already know what their own yellow
/// means and do not need it called `Claim`.
pub fn colour_name(hsl: &str) -> &'static str {
    let mut parts = hsl.split_whitespace();
    let hue: f64 = parts.next().and_then(|h| h.parse().ok()).unwrap_or(0.0);
    let saturation: f64 = parts
        .next()
        .and_then(|s| s.trim_end_matches('%').parse().ok())
        .unwrap_or(0.0);

    // Below this there is no hue worth naming, whatever the number says.
    if saturation < 15.0 {
        return "Gray";
    }

    match hue as i64 {
        0..=14 => "Red",
        15..=44 => "Orange",
        45..=69 => "Yellow",
        70..=169 => "Green",
        170..=199 => "Teal",
        200..=254 => "Blue",
        255..=294 => "Purple",
        295..=339 => "Magenta",
        _ => "Red",
    }
}

/// Rename every label after the colour it is.
///
/// Returns how many changed, so nothing is claimed when nothing happened.
pub async fn name_labels_after_colours(pool: &SqlitePool) -> Result<u64, String> {
    let labels = annotation_labels(pool).await?;
    let mut renamed = 0;

    for label in labels {
        let name = colour_name(&label.colour);
        if label.name == name {
            continue;
        }

        sqlx::query("UPDATE annotation_labels SET name = ? WHERE id = ?")
            .bind(name)
            .bind(&label.id)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

        renamed += 1;
    }

    Ok(renamed)
}

/// Put back any of the default labels that are missing.
///
/// Deliberately not run on open — that is what made a deliberately deleted
/// label reappear the next morning. This is an explicit action, for the reader
/// who cleared the lot and wants a starting point again, and `INSERT OR IGNORE`
/// means it leaves renamed and recoloured labels exactly as they are.
pub async fn restore_default_labels(pool: &SqlitePool) -> Result<u64, String> {
    let mut restored = 0;

    for (position, (id, name, colour)) in DEFAULT_LABELS.iter().enumerate() {
        let result = sqlx::query(
            "INSERT OR IGNORE INTO annotation_labels (id, name, colour, position, enabled)
             VALUES (?, ?, ?, ?, 1)",
        )
        .bind(id)
        .bind(name)
        .bind(colour)
        .bind(position as i64)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

        restored += result.rows_affected();
    }

    Ok(restored)
}
