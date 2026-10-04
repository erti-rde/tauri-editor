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

use super::index::{Filter, HitKind, Index, Key, Row as IndexRow};
use super::{pack_embedding, unpack_embedding};

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct Source {
    /// The work's canonical id (ADR 003): a file's hash, or `erti:<uuid>` for
    /// a work with no file of its own.
    pub sha256: String,
    pub file_name: String,
    pub path: Option<String>,
    /// Whose file `path` is: the work's own hash, or the hash of a PDF attached
    /// to it. Ingesting that file goes under this id, never under `sha256`, or
    /// a PDF's chunks and extracted metadata would land on the work.
    pub file_sha256: Option<String>,
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
    /// The file the passage is in, which "Show in PDF" opens. Not for citing:
    /// a file attached to a work is an alias of it (ADR 003).
    pub sha256: String,
    /// The work the passage belongs to: the id to cite, to add to a project
    /// and to read metadata from.
    pub source_id: String,
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

    // A source added from a manuscript (M1a-8) is `ready` with no file, since
    // there was nothing to read. Its PDF arriving is the first chance to
    // extract and embed it, so its first location puts it back in the queue.
    let had_file: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM locations WHERE sha256 = ?)")
            .bind(sha256)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

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
    } else if !had_file {
        sqlx::query(
            "INSERT INTO ingest_status (sha256, state) VALUES (?, 'pending')
             ON CONFLICT(sha256) DO UPDATE SET state = 'pending', attempts = 0, last_error = NULL",
        )
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

/// Add a source the library doesn't have, from the snapshot a manuscript
/// carries (M1a-8, UX-12 "Add to library").
///
/// It has metadata and no file: nothing to extract, so it's recorded as ready
/// and never offered for ingest, and no location says where a PDF is. Keyed by
/// the id the manuscript cites, which for a paper is the hash of the
/// co-author's PDF, so adding that PDF later lands on this same source.
///
/// A source already in the library is left exactly as it is: its own metadata
/// and ingest state win over a snapshot. Returns whether it was new.
pub async fn add_source_without_file(
    pool: &SqlitePool,
    id: &str,
    csl_json: &str,
    zotero_type: Option<&str>,
    doi: Option<&str>,
) -> Result<bool, String> {
    // One transaction, as in `register_source`: a source left without its
    // ingest status would never get one, since the next try finds it present.
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let inserted = sqlx::query(
        "INSERT OR IGNORE INTO sources (sha256, csl_json, zotero_type, doi, resolved_via, resolved_at)
         VALUES (?, ?, ?, ?, 'manuscript', CURRENT_TIMESTAMP)",
    )
    .bind(id)
    .bind(csl_json)
    .bind(zotero_type)
    .bind(doi)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .rows_affected()
        > 0;

    if inserted {
        sqlx::query("INSERT OR IGNORE INTO ingest_status (sha256, state) VALUES (?, 'ready')")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(inserted)
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
///
/// One row per work (ADR 003). The `source_set` may name a work by any of its
/// ids: a folder scan adds a PDF's own hash after it was attached to a work,
/// and a manuscript adds whichever id it cites. Each is resolved here, on
/// reading, rather than rewritten when stored, so attaching a file or merging
/// two works never rewrites a project's set. Removing a work (M1b-4) takes
/// its attached files with it, and ids that name nothing are skipped.
pub async fn project_sources(
    library: &SqlitePool,
    project: &SqlitePool,
) -> Result<Vec<Source>, String> {
    let hashes = project_source_hashes(project).await?;
    if hashes.is_empty() {
        return Ok(Vec::new());
    }

    let aliases = alias_map(library).await?;
    let ids = resolve_all(&aliases, &hashes);

    // An override made on an id that has since been merged into another work
    // still applies to that work, unless the work has one of its own. Newest
    // first, so of two merged ids' overrides, the later correction wins; the
    // timestamp is to the second, so a tie goes to the lower id, not row order.
    let mut overrides: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for row in sqlx::query(
        "SELECT sha256, csl_json FROM metadata_overrides ORDER BY updated_at DESC, sha256",
    )
    .fetch_all(project)
    .await
    .map_err(|e| e.to_string())?
    {
        let id: String = row.get("sha256");
        let work = resolve(&aliases, &id).to_string();
        if work == id {
            overrides.insert(work, row.get("csl_json"));
        } else {
            overrides.entry(work).or_insert_with(|| row.get("csl_json"));
        }
    }

    let placeholders = std::iter::repeat_n("?", ids.len())
        .collect::<Vec<_>>()
        .join(",");
    // A work with no file of its own opens the PDF attached to it: `locations`
    // is keyed by the file's hash, which is the alias. The work's own file
    // comes first, and a work is never an alias, so that's the non-alias row.
    let sql = format!(
        "SELECT s.sha256, s.csl_json, s.zotero_type, s.doi, s.resolved_via,
                COALESCE(i.state, 'pending') AS state, i.last_error,
                (SELECT file_name FROM locations l
                  WHERE l.sha256 = s.sha256
                     OR l.sha256 IN (SELECT alias FROM source_aliases WHERE canonical = s.sha256)
                  ORDER BY l.sha256 IN (SELECT alias FROM source_aliases), last_seen DESC LIMIT 1) AS file_name,
                (SELECT path FROM locations l
                  WHERE l.sha256 = s.sha256
                     OR l.sha256 IN (SELECT alias FROM source_aliases WHERE canonical = s.sha256)
                  ORDER BY l.sha256 IN (SELECT alias FROM source_aliases), last_seen DESC LIMIT 1) AS path,
                (SELECT l.sha256 FROM locations l
                  WHERE l.sha256 = s.sha256
                     OR l.sha256 IN (SELECT alias FROM source_aliases WHERE canonical = s.sha256)
                  ORDER BY l.sha256 IN (SELECT alias FROM source_aliases), last_seen DESC LIMIT 1) AS file_sha256
           FROM sources s
           LEFT JOIN ingest_status i ON i.sha256 = s.sha256
          WHERE s.sha256 IN ({placeholders})"
    );

    let mut query = sqlx::query(&sql);
    for id in &ids {
        query = query.bind(*id);
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
                file_sha256: r.get("file_sha256"),
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

/// Every alias in the library, alias → canonical (ADR 003).
///
/// Read whole rather than id by id: a library has a handful of aliases, and
/// the searches below resolve every row they score.
pub async fn alias_map(
    library: &SqlitePool,
) -> Result<std::collections::HashMap<String, String>, String> {
    Ok(
        sqlx::query_as::<_, (String, String)>("SELECT alias, canonical FROM source_aliases")
            .fetch_all(library)
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .collect(),
    )
}

/// The id a work is known by: the one to cite, to keep in a project's
/// `source_set`, and to read metadata from.
///
/// One lookup, because `alias_source` never writes a chain. An id the library
/// has never seen is its own canonical id, so a co-author's citation still
/// finds the snapshot their manuscript carries.
pub fn resolve<'a>(aliases: &'a std::collections::HashMap<String, String>, id: &'a str) -> &'a str {
    aliases.get(id).map(String::as_str).unwrap_or(id)
}

/// Every id resolved, each work once, in the order first named: one citation
/// that names a book and its PDF cites the book once.
pub fn resolve_all<'a>(
    aliases: &'a std::collections::HashMap<String, String>,
    ids: &'a [String],
) -> Vec<&'a str> {
    let mut seen = std::collections::HashSet::new();
    ids.iter()
        .map(|id| resolve(aliases, id))
        .filter(|id| seen.insert(*id))
        .collect()
}

/// `resolve`, for one id, against the library.
pub async fn canonical(library: &SqlitePool, id: &str) -> Result<String, String> {
    let found: Option<String> =
        sqlx::query_scalar("SELECT canonical FROM source_aliases WHERE alias = ?")
            .bind(id)
            .fetch_optional(library)
            .await
            .map_err(|e| e.to_string())?;
    Ok(found.unwrap_or_else(|| id.to_string()))
}

/// Say that `alias` is the same work as `canonical` (ADR 003).
///
/// The only write to `source_aliases`, so the only place a chain could start.
/// Attaching a PDF to a work and merging two duplicates are both this. A
/// `canonical` that is itself an alias is resolved first, and whatever pointed
/// at `alias` is re-pointed at the result, so every alias stays one step from
/// its work. Naming one of a work's aliases as the canonical promotes it: its
/// own alias row goes first. Refused: an id as an alias of itself, and an id
/// the library doesn't have.
///
/// Source notes are kept on the canonical id (ADR 004), so `alias`'s notes
/// move to the work it now belongs to. Left where they were, they would go
/// with that id's row if it were removed.
pub async fn alias_source(
    library: &SqlitePool,
    alias: &str,
    canonical: &str,
) -> Result<(), String> {
    if alias == canonical {
        return Err(format!("{alias} can't be an alias of itself."));
    }
    let mut tx = library.begin().await.map_err(|e| e.to_string())?;

    for id in [alias, canonical] {
        let known: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sources WHERE sha256 = ?)")
                .bind(id)
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        if !known {
            return Err(format!("The library has no source {id}."));
        }
    }

    sqlx::query("DELETE FROM source_aliases WHERE alias = ? AND canonical = ?")
        .bind(canonical)
        .bind(alias)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let target: String = sqlx::query_scalar(
        "SELECT COALESCE((SELECT canonical FROM source_aliases WHERE alias = ?1), ?1)",
    )
    .bind(canonical)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Unreachable while the table has no chains: `canonical` would have to be
    // an alias of `alias`, and that row was deleted above. Checked anyway,
    // since the insert below would otherwise write the cycle.
    if target == alias {
        return Err(format!(
            "{alias} is already the work {canonical} belongs to."
        ));
    }

    for sql in [
        "UPDATE source_aliases SET canonical = ?1 WHERE canonical = ?2",
        "INSERT INTO source_aliases (alias, canonical) VALUES (?2, ?1)
         ON CONFLICT(alias) DO UPDATE SET canonical = excluded.canonical",
        "UPDATE source_notes SET sha256 = ?1 WHERE sha256 = ?2",
    ] {
        sqlx::query(sql)
            .bind(&target)
            .bind(alias)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// What removing a work would take with it, for the dialog that asks first
/// (docs/ux.md UX-4).
#[derive(Debug, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct SourceRemoval {
    /// Source notes, and page notes on its files.
    pub notes: u32,
    /// Highlights and area snapshots on its files.
    pub highlights: u32,
    /// Everywhere its files have been seen, the work's own and every attached
    /// one's: any inside the project folder is read again by the next scan.
    pub paths: Vec<String>,
}

/// A work and every file attached to it: what "remove from the library" means
/// for the id the researcher picked, whichever of them it was (ADR 003).
///
/// Removing only the work's own row would leave an attached PDF behind as a
/// work of its own, with the highlights the dialog said were going.
async fn work_and_files(library: &SqlitePool, id: &str) -> Result<Vec<String>, String> {
    let aliases = alias_map(library).await?;
    let work = resolve(&aliases, id).to_string();
    let mut group: Vec<String> = aliases
        .iter()
        .filter(|(_, canonical)| **canonical == work)
        .map(|(alias, _)| alias.clone())
        .collect();
    group.sort();
    group.insert(0, work);
    Ok(group)
}

pub async fn source_removal(library: &SqlitePool, id: &str) -> Result<SourceRemoval, String> {
    let group =
        serde_json::to_string(&work_and_files(library, id).await?).map_err(|e| e.to_string())?;
    let (notes, highlights): (i64, i64) = sqlx::query_as(
        "SELECT
           (SELECT COUNT(*) FROM source_notes WHERE sha256 IN (SELECT value FROM json_each(?1)))
         + (SELECT COUNT(*) FROM annotations
             WHERE kind = 'page-note' AND sha256 IN (SELECT value FROM json_each(?1))),
           (SELECT COUNT(*) FROM annotations
             WHERE kind <> 'page-note' AND sha256 IN (SELECT value FROM json_each(?1)))",
    )
    .bind(&group)
    .fetch_one(library)
    .await
    .map_err(|e| e.to_string())?;
    let paths = sqlx::query_scalar(
        "SELECT path FROM locations WHERE sha256 IN (SELECT value FROM json_each(?))
         ORDER BY path",
    )
    .bind(&group)
    .fetch_all(library)
    .await
    .map_err(|e| e.to_string())?;
    Ok(SourceRemoval {
        notes: u32::try_from(notes).unwrap_or(u32::MAX),
        highlights: u32::try_from(highlights).unwrap_or(u32::MAX),
        paths,
    })
}

/// Remove a work from the library, with every file attached to it.
///
/// One delete: every table that hangs off a source cascades from it (chunks,
/// locations, ingest state, marks and their images and vectors, source notes
/// and theirs, reading positions, and the alias rows on either side). The PDF
/// files themselves are never touched. A project's `source_set` and metadata
/// corrections keep the id, as every project's do: they're in other
/// databases, and the manuscripts citing it render from their own copy
/// (M1a-8) until it's added again.
pub async fn remove_source(library: &SqlitePool, id: &str) -> Result<(), String> {
    let group =
        serde_json::to_string(&work_and_files(library, id).await?).map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM sources WHERE sha256 IN (SELECT value FROM json_each(?))")
        .bind(&group)
        .execute(library)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Rank chunks against a query vector.
///
/// Scoring happens in Rust rather than in the webview: the old implementation
/// selected every chunk and embedding, sent them across the IPC boundary, and
/// ran cosine in JS on the main thread. Only the top results cross now.
///
/// Results carry `in_project` so the UI can list the project's own sources first
/// while keeping the rest of the library one click away.
///
/// This builds an index for the one query. The app holds one per library
/// instead (`DbState::index`) and calls `search_chunks`.
pub async fn search_similar(
    library: &SqlitePool,
    query_embedding: &[f32],
    project_hashes: &[String],
    limit: usize,
    include_library: bool,
) -> Result<Vec<ScoredChunk>, String> {
    let index = super::index::load(library).await?;
    search_chunks(
        &index,
        library,
        query_embedding,
        project_hashes,
        limit,
        include_library,
    )
    .await
}

/// `search_similar` on an index already built.
pub async fn search_chunks(
    index: &Index,
    library: &SqlitePool,
    query_embedding: &[f32],
    project_hashes: &[String],
    limit: usize,
    include_library: bool,
) -> Result<Vec<ScoredChunk>, String> {
    let hits = search_index(
        index,
        library,
        query_embedding,
        project_hashes,
        &[HitKind::Chunk],
        limit,
        include_library,
    )
    .await?;
    Ok(hits
        .into_iter()
        .filter_map(|hit| match hit {
            Hit::Chunk(chunk) => Some(chunk),
            _ => None,
        })
        .collect())
}

/// Every vector in the library, for the index: chunks, marks and source notes.
///
/// No order is asked for, so rows come back as the tables are laid out, which
/// is the order the scan in `search_similar` read them in before the index.
pub async fn index_rows(library: &SqlitePool) -> Result<Vec<IndexRow>, String> {
    let mut rows = Vec::new();

    for r in sqlx::query("SELECT sha256, idx, embedding FROM chunks")
        .fetch_all(library)
        .await
        .map_err(|e| e.to_string())?
    {
        let sha256: String = r.get("sha256");
        rows.push(IndexRow {
            key: Key::Chunk {
                sha256: sha256.clone(),
                idx: r.get("idx"),
            },
            owner: sha256,
            embedding: unpack_embedding(&r.get::<Vec<u8>, _>("embedding")),
        });
    }

    for r in sqlx::query(
        "SELECT a.id, a.sha256, e.embedding
           FROM annotations a JOIN annotation_embeddings e ON e.id = a.id",
    )
    .fetch_all(library)
    .await
    .map_err(|e| e.to_string())?
    {
        rows.push(IndexRow {
            key: Key::Annotation(r.get("id")),
            owner: r.get("sha256"),
            embedding: unpack_embedding(&r.get::<Vec<u8>, _>("embedding")),
        });
    }

    for r in sqlx::query(
        "SELECT n.id, n.sha256, e.embedding
           FROM source_notes n JOIN source_note_embeddings e ON e.id = n.id",
    )
    .fetch_all(library)
    .await
    .map_err(|e| e.to_string())?
    {
        rows.push(IndexRow {
            key: Key::SourceNote(r.get("id")),
            owner: r.get("sha256"),
            embedding: unpack_embedding(&r.get::<Vec<u8>, _>("embedding")),
        });
    }

    Ok(rows)
}

/// A note about a work as a whole (ADR 004).
#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct SourceNote {
    pub id: String,
    /// The work's id. Always canonical when written (`alias_source` moves a
    /// work's notes with it).
    pub sha256: String,
    /// Markdown. Empty when the note is only the quote.
    pub body: String,
    pub quote: Option<String>,
    /// The page as the paper prints it.
    pub page_label: Option<String>,
    pub label_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A source note, ranked against something the researcher is looking for.
#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct ScoredSourceNote {
    #[serde(flatten)]
    pub note: SourceNote,
    pub similarity: f32,
    /// The work the note is about, resolved (ADR 003).
    pub source_id: String,
    /// False when the work is outside the open project's source set.
    pub in_project: bool,
}

/// One result from the index, whatever kind of row it is (ADR 005).
///
/// `kind` says which, and `hit` holds the row as each kind's own search
/// returns it. Adjacent rather than flattened: a mark already has a field
/// called `kind` (highlight, area, page note).
// A search returns a few dozen of these at most, so the size of the largest
// variant costs nothing worth a `Box` in every match.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", content = "hit", rename_all = "snake_case")]
pub enum Hit {
    Chunk(ScoredChunk),
    Annotation(ScoredAnnotation),
    SourceNote(ScoredSourceNote),
}

/// The best `limit` rows of the index for a query vector, read back in full.
///
/// `kinds` (empty for all) and the project scope are applied before scoring.
/// The project's rows come first, then the closest, across kinds: a caller
/// that shows kinds apart asks for one at a time, or splits by `kind`.
///
/// A row the index holds but the library no longer has is left out. It can
/// only happen in the moment between a delete and the index being dropped.
pub async fn search_index(
    index: &Index,
    library: &SqlitePool,
    query_embedding: &[f32],
    project_hashes: &[String],
    kinds: &[HitKind],
    limit: usize,
    include_library: bool,
) -> Result<Vec<Hit>, String> {
    // Membership is by work on both sides: the project may name a work by a
    // file's hash, and a chunk always comes from a file.
    let aliases = alias_map(library).await?;
    let in_set: std::collections::HashSet<&str> = project_hashes
        .iter()
        .map(|id| resolve(&aliases, id))
        .collect();
    let filter = Filter {
        kinds,
        project: &in_set,
        include_library,
        aliases: &aliases,
    };

    let mut hits = Vec::new();
    for found in index.search(query_embedding, &filter, limit) {
        let source_id = found.source_id.to_string();
        let hit = match found.key {
            Key::Chunk { sha256, idx } => sqlx::query(
                "SELECT text, page_start, section FROM chunks WHERE sha256 = ? AND idx = ?",
            )
            .bind(sha256)
            .bind(idx)
            .fetch_optional(library)
            .await
            .map_err(|e| e.to_string())?
            .map(|r| {
                Hit::Chunk(ScoredChunk {
                    sha256: sha256.clone(),
                    source_id,
                    idx: *idx,
                    text: r.get("text"),
                    page_start: r.get("page_start"),
                    section: r.get("section"),
                    similarity: found.similarity,
                    in_project: found.in_project,
                })
            }),
            Key::Annotation(id) => {
                sqlx::query(&format!("{ANNOTATION_SEARCH_SELECT} WHERE a.id = ?"))
                    .bind(id)
                    .fetch_optional(library)
                    .await
                    .map_err(|e| e.to_string())?
                    .map(|r| {
                        Hit::Annotation(ScoredAnnotation {
                            annotation: annotation_from(&r),
                            similarity: found.similarity,
                            source_id,
                            in_project: found.in_project,
                            file_name: r.try_get("file_name").ok(),
                        })
                    })
            }
            Key::SourceNote(id) => sqlx::query(
                "SELECT id, sha256, body, quote, page_label, label_id, created_at, updated_at
                   FROM source_notes WHERE id = ?",
            )
            .bind(id)
            .fetch_optional(library)
            .await
            .map_err(|e| e.to_string())?
            .map(|r| {
                Hit::SourceNote(ScoredSourceNote {
                    note: SourceNote {
                        id: r.get("id"),
                        sha256: r.get("sha256"),
                        body: r.get("body"),
                        quote: r.get("quote"),
                        page_label: r.get("page_label"),
                        label_id: r.get("label_id"),
                        created_at: r.get("created_at"),
                        updated_at: r.get("updated_at"),
                    },
                    similarity: found.similarity,
                    source_id,
                    in_project: found.in_project,
                })
            }),
        };
        hits.extend(hit);
    }
    Ok(hits)
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
    /// The work the mark's paper belongs to, for citing it (ADR 003). The
    /// annotation's own `sha256` stays the file's, for "Show in PDF".
    pub source_id: String,
    /// False when the mark is on a paper outside the open project's source set.
    pub in_project: bool,
    /// The paper's filename, so a result can name where it came from.
    pub file_name: Option<String>,
}

fn scored_from(
    row: &sqlx::sqlite::SqliteRow,
    similarity: f32,
    aliases: &std::collections::HashMap<String, String>,
    in_set: &std::collections::HashSet<&str>,
) -> ScoredAnnotation {
    let annotation = annotation_from(row);
    let source_id = resolve(aliases, &annotation.sha256).to_string();
    ScoredAnnotation {
        in_project: in_set.contains(source_id.as_str()),
        source_id,
        annotation,
        similarity,
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

/// Find marks by the words in them.
///
/// `LIKE` rather than FTS5, deliberately. There is no full-text index anywhere
/// in this database, and adding one means a virtual table plus triggers to keep
/// it honest. A researcher has hundreds of marks, not millions; scanning them is
/// microseconds. FTS5 is the answer if that ever stops being true, and measuring
/// is how we would know.
///
/// An empty query filters nothing: every mark, with its paper's name and
/// whether it's in the project. That's what browsing the Notes panel shows. A
/// `LIKE '%%'` would have skipped marks with neither a quote nor a note, such
/// as an area snapshot nobody has annotated yet.
///
/// The project's marks come first, then the newest: the limit applies after
/// ordering, and a busy week in another project mustn't push this one's marks
/// out of the list, as the semantic search already ensures.
pub async fn search_annotations_literally(
    pool: &SqlitePool,
    query: &str,
    project_hashes: &[String],
    limit: i64,
) -> Result<Vec<ScoredAnnotation>, String> {
    let pattern = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
    let aliases = alias_map(pool).await?;
    let in_set: std::collections::HashSet<&str> = project_hashes
        .iter()
        .map(|id| resolve(&aliases, id))
        .collect();
    let project = serde_json::to_string(&in_set).map_err(|e| e.to_string())?;

    // Ordered by the work the mark's paper belongs to, as `in_project` is.
    let rows = sqlx::query(&format!(
        "{ANNOTATION_SEARCH_SELECT}
          WHERE ?3 OR a.quote LIKE ?1 ESCAPE '\\' OR a.note LIKE ?1 ESCAPE '\\'
          ORDER BY COALESCE((SELECT canonical FROM source_aliases WHERE alias = a.sha256), a.sha256)
                   IN (SELECT value FROM json_each(?4)) DESC,
                   a.created_at DESC
          LIMIT ?2"
    ))
    .bind(&pattern)
    .bind(limit)
    .bind(query.is_empty())
    .bind(&project)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|row| scored_from(row, 1.0, &aliases, &in_set))
        .collect())
}

/// Find marks by what they are about.
///
/// Scored in Rust over the whole set, the same way `search_similar` handles
/// chunks: a mark's vector has no reason to cross the IPC boundary when only the
/// ranking is wanted on the other side. Every mark is a candidate, the
/// project's first, as in the literal search.
///
/// Like `search_similar`, this builds an index for the one query; the app
/// calls `search_annotations_in` with the library's own.
pub async fn search_annotations_semantically(
    pool: &SqlitePool,
    query_embedding: &[f32],
    project_hashes: &[String],
    limit: usize,
) -> Result<Vec<ScoredAnnotation>, String> {
    let index = super::index::load(pool).await?;
    search_annotations_in(&index, pool, query_embedding, project_hashes, limit).await
}

/// `search_annotations_semantically` on an index already built.
pub async fn search_annotations_in(
    index: &Index,
    pool: &SqlitePool,
    query_embedding: &[f32],
    project_hashes: &[String],
    limit: usize,
) -> Result<Vec<ScoredAnnotation>, String> {
    let hits = search_index(
        index,
        pool,
        query_embedding,
        project_hashes,
        &[HitKind::Annotation],
        limit,
        true,
    )
    .await?;
    Ok(hits
        .into_iter()
        .filter_map(|hit| match hit {
            Hit::Annotation(mark) => Some(mark),
            _ => None,
        })
        .collect())
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
