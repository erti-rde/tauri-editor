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
use sqlx::sqlite::{SqliteConnection, SqlitePool};
use sqlx::Row;
use std::collections::BTreeSet;

use super::index::{Changed, Filter, HitKind, Index, Key, Row as IndexRow};
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
    /// The work's own state: whether it can be cited. A work entered by hand
    /// is `ready` while a PDF attached to it is still being read.
    pub state: String,
    pub last_error: Option<String>,
    /// The ingest state of the file at `path`, which for an attached PDF is
    /// not the work's (M1b-7 AC-1). None when the work has no file.
    pub file_state: Option<String>,
    pub file_error: Option<String>,
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
    let inserted = register_source_on(&mut tx, sha256, path, file_name).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(inserted)
}

/// `register_source`, inside a transaction the caller holds.
async fn register_source_on(
    tx: &mut SqliteConnection,
    sha256: &str,
    path: &str,
    file_name: &str,
) -> Result<bool, String> {
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
    let added =
        insert_source_without_file(pool, id, csl_json, zotero_type, doi, "manuscript", false)
            .await?;
    Ok(added == Added::Yes)
}

/// What became of a work added without a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Added {
    Yes,
    /// The library has a source with that id already.
    IdTaken,
    /// The library has a source with that DOI already (M1b-6 AC-3).
    DoiTaken,
}

/// A source the researcher entered by hand (M1b-5): an `erti:<uuid>` work
/// with no file, its details as typed. A DOI the library has already is
/// refused, so citations aren't split between two copies.
///
/// Recorded as resolved `'by-hand'`, not `'manual'`: that already means a
/// DOI typed by hand and its details fetched, which is a different source of
/// truth (the schema's comment on the column predates both).
pub async fn add_source_by_hand(
    pool: &SqlitePool,
    id: &str,
    csl_json: &str,
    zotero_type: &str,
    doi: Option<&str>,
) -> Result<Added, String> {
    insert_source_without_file(pool, id, csl_json, Some(zotero_type), doi, "by-hand", true).await
}

/// A source whose details were fetched for a DOI the researcher typed (M1b-6):
/// an `erti:<uuid>` work with no file, resolved `'manual'` as a DOI typed into
/// a failed PDF's row is.
pub async fn add_source_from_doi(
    pool: &SqlitePool,
    id: &str,
    csl_json: &str,
    zotero_type: &str,
    doi: &str,
) -> Result<Added, String> {
    insert_source_without_file(
        pool,
        id,
        csl_json,
        Some(zotero_type),
        Some(doi),
        "manual",
        true,
    )
    .await
}

/// A DOI as the library compares it: lowercase, without a resolver's prefix
/// (`https://doi.org/`, `doi:`), trimmed. None when nothing is left.
///
/// DOIs are case-insensitive, and are written as links as often as not; a
/// DOI typed as one must still be found by, and find, the bare one.
pub fn normalise_doi(doi: &str) -> Option<String> {
    let lower = doi.trim().to_lowercase();
    let bare = [
        "https://doi.org/",
        "http://doi.org/",
        "https://dx.doi.org/",
        "http://dx.doi.org/",
        "doi:",
    ]
    .iter()
    .find_map(|prefix| lower.strip_prefix(prefix))
    .unwrap_or(&lower)
    .trim();
    (!bare.is_empty()).then(|| bare.to_string())
}

/// Every source's DOI as `normalise_doi` writes it, as `bare (sha256,
/// created_at, doi)`: from the column, or the details' own `DOI` when it has
/// none. Rows stored before DOIs were normalised may hold any case or a link.
macro_rules! bare_dois {
    () => {
        "WITH stored AS (
           SELECT sha256, created_at,
                  lower(trim(COALESCE(doi,
                    CASE WHEN json_valid(csl_json) THEN json_extract(csl_json, '$.DOI') END))) AS v
             FROM sources
         ), bare AS (
           SELECT sha256, created_at,
                  trim(CASE
                    WHEN v LIKE 'https://doi.org/%' THEN substr(v, 17)
                    WHEN v LIKE 'http://doi.org/%' THEN substr(v, 16)
                    WHEN v LIKE 'https://dx.doi.org/%' THEN substr(v, 20)
                    WHEN v LIKE 'http://dx.doi.org/%' THEN substr(v, 19)
                    WHEN v LIKE 'doi:%' THEN substr(v, 5)
                    ELSE v
                  END) AS doi
             FROM stored WHERE v IS NOT NULL
         )
         "
    };
}

/// The work in the library with this DOI, if any (M1b-6 AC-3): its canonical
/// id, so a PDF attached to a work finds the work (ADR 003).
///
/// Compared as `normalise_doi` writes it, on both sides: rows stored before
/// DOIs were normalised, or with only the details' own `DOI`, may hold any
/// case or a link. The column is read first, then the details' `DOI`, since a
/// source added from a manuscript may have only the latter.
pub async fn source_for_doi(
    db: impl sqlx::SqliteExecutor<'_>,
    doi: &str,
) -> Result<Option<String>, String> {
    let Some(doi) = normalise_doi(doi) else {
        return Ok(None);
    };
    sqlx::query_scalar(concat!(
        bare_dois!(),
        "SELECT COALESCE(a.canonical, b.sha256)
           FROM bare b
           LEFT JOIN source_aliases a ON a.alias = b.sha256
          WHERE b.doi = ?
          ORDER BY b.created_at, b.sha256
          LIMIT 1"
    ))
    .bind(doi)
    .fetch_optional(db)
    .await
    .map_err(|e| e.to_string())
}

async fn insert_source_without_file(
    pool: &SqlitePool,
    id: &str,
    csl_json: &str,
    zotero_type: Option<&str>,
    doi: Option<&str>,
    resolved_via: &str,
    one_per_doi: bool,
) -> Result<Added, String> {
    // One transaction, as in `register_source`: a source left without its
    // ingest status would never get one, since the next try finds it present.
    //
    // BEGIN IMMEDIATE, not sqlx's deferred BEGIN: the write lock is taken
    // before the DOI is checked, so two adds of one DOI at once queue and the
    // second finds the first. Deferred, both could find it free (WAL keeps
    // each reader's snapshot), and the second would fail as busy, not as a
    // duplicate. sqlx 0.8.2 can't begin one itself, so the connection isn't
    // returned to the pool: one dropped mid-transaction mustn't be reused.
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    conn.close_on_drop();
    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    let added = insert_without_file_on(
        &mut conn,
        id,
        csl_json,
        zotero_type,
        doi,
        resolved_via,
        one_per_doi,
    )
    .await;
    if added == Ok(Added::Yes) {
        sqlx::query("COMMIT")
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    } else {
        // An insert that failed may have rolled back on its own (SQLITE_FULL
        // does), and then this fails too: what's said is why the insert did.
        let _ = sqlx::query("ROLLBACK").execute(&mut *conn).await;
    }
    added
}

async fn insert_without_file_on(
    conn: &mut sqlx::SqliteConnection,
    id: &str,
    csl_json: &str,
    zotero_type: Option<&str>,
    doi: Option<&str>,
    resolved_via: &str,
    one_per_doi: bool,
) -> Result<Added, String> {
    if one_per_doi {
        if let Some(doi) = doi {
            if source_for_doi(&mut *conn, doi).await?.is_some() {
                return Ok(Added::DoiTaken);
            }
        }
    }

    let inserted = sqlx::query(
        "INSERT OR IGNORE INTO sources (sha256, csl_json, zotero_type, doi, resolved_via, resolved_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
    )
    .bind(id)
    .bind(csl_json)
    .bind(zotero_type)
    .bind(doi)
    .bind(resolved_via)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .rows_affected()
        > 0;
    if !inserted {
        return Ok(Added::IdTaken);
    }

    sqlx::query("INSERT OR IGNORE INTO ingest_status (sha256, state) VALUES (?, 'ready')")
        .bind(id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(Added::Yes)
}

/// A source from an imported bibliography (M1b-9): an `erti:<uuid>` work with
/// no file, checked as one entered by hand is.
pub struct Imported<'a> {
    pub id: &'a str,
    pub csl_json: &'a str,
    pub zotero_type: &'a str,
    pub doi: Option<&'a str>,
}

/// Add a batch of imported sources in one transaction, each as
/// `add_source_by_hand` would (M1b-9 AC-6). Returns what became of each, in
/// order: a DOI the library has, or an earlier one in the batch has, is
/// refused, as an id the library has is.
///
/// The library's DOIs are read once for the batch rather than once per
/// source: `source_for_doi` reads every row, and ten thousand of those into
/// a library of ten thousand took minutes.
pub async fn import_sources(
    pool: &SqlitePool,
    sources: &[Imported<'_>],
) -> Result<Vec<Added>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    // As in `insert_source_without_file`: the lock is taken before the DOIs
    // are read, and a connection dropped mid-transaction isn't reused.
    conn.close_on_drop();
    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    let added = import_on(&mut conn, sources).await;
    if added.is_ok() {
        sqlx::query("COMMIT")
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    } else {
        let _ = sqlx::query("ROLLBACK").execute(&mut *conn).await;
    }
    added
}

async fn import_on(
    conn: &mut SqliteConnection,
    sources: &[Imported<'_>],
) -> Result<Vec<Added>, String> {
    let wanted: Vec<String> = sources
        .iter()
        .filter_map(|s| s.doi.and_then(normalise_doi))
        .collect();
    let mut taken: std::collections::HashSet<String> = if wanted.is_empty() {
        Default::default()
    } else {
        let wanted = serde_json::to_string(&wanted).map_err(|e| e.to_string())?;
        sqlx::query_scalar(concat!(
            bare_dois!(),
            "SELECT DISTINCT doi FROM bare WHERE doi IN (SELECT value FROM json_each(?))"
        ))
        .bind(wanted)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .collect()
    };

    let mut added = Vec::with_capacity(sources.len());
    for source in sources {
        let doi = source.doi.and_then(normalise_doi);
        if doi.as_ref().is_some_and(|doi| taken.contains(doi)) {
            added.push(Added::DoiTaken);
            continue;
        }
        let outcome = insert_without_file_on(
            conn,
            source.id,
            source.csl_json,
            Some(source.zotero_type),
            doi.as_deref(),
            "import",
            false,
        )
        .await?;
        if outcome == Added::Yes {
            if let Some(doi) = doi {
                taken.insert(doi);
            }
        }
        added.push(outcome);
    }
    Ok(added)
}

/// A work in the library, as matching an import against it needs (M1b-9
/// AC-4): its canonical id, details and DOI.
#[derive(Debug, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct LibraryWork {
    pub id: String,
    pub csl_json: Option<String>,
    pub doi: Option<String>,
}

/// Every source in the library with details, under the id of the work it is
/// (ADR 003): a PDF attached to a work matches as that work.
pub async fn library_works(pool: &SqlitePool) -> Result<Vec<LibraryWork>, String> {
    let rows = sqlx::query(
        "SELECT COALESCE(a.canonical, s.sha256) AS id, s.csl_json, s.doi
           FROM sources s
           LEFT JOIN source_aliases a ON a.alias = s.sha256
          WHERE s.csl_json IS NOT NULL OR s.doi IS NOT NULL
          ORDER BY s.created_at, s.sha256",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|row| LibraryWork {
            id: row.get("id"),
            csl_json: row.get("csl_json"),
            doi: row.get("doi"),
        })
        .collect())
}

/// Add these sources to the project in one transaction (M1b-9, "Also add them
/// to this project").
pub async fn add_all_to_project(project: &SqlitePool, ids: &[String]) -> Result<(), String> {
    let mut tx = project.begin().await.map_err(|e| e.to_string())?;
    for id in ids {
        sqlx::query("INSERT OR IGNORE INTO source_set (sha256) VALUES (?)")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
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
        "SELECT q.*, fi.state AS file_state, fi.last_error AS file_error FROM (
         SELECT s.sha256, s.csl_json, s.zotero_type, s.doi, s.resolved_via,
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
          WHERE s.sha256 IN ({placeholders})
         ) q LEFT JOIN ingest_status fi ON fi.sha256 = q.file_sha256"
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
                // A file with no ingest row yet is waiting to be read.
                file_state: r.get::<Option<String>, _>("file_sha256").map(|_| {
                    r.get::<Option<String>, _>("file_state")
                        .unwrap_or_else(|| "pending".into())
                }),
                file_error: r.get("file_error"),
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
    let mut tx = library.begin().await.map_err(|e| e.to_string())?;
    alias_source_on(&mut tx, alias, canonical).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// `alias_source`, inside a transaction the caller holds.
async fn alias_source_on(
    tx: &mut SqliteConnection,
    alias: &str,
    canonical: &str,
) -> Result<(), String> {
    if alias == canonical {
        return Err(format!("{alias} can't be an alias of itself."));
    }

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

    Ok(())
}

/// What attaching a file to a work came to (M1b-7, ADR 003).
#[derive(Debug, PartialEq, Eq)]
pub enum Attach {
    /// Attached. `needs_ingest` when the file hasn't been read yet, or failed;
    /// `merged` names the source the file was until now, when the library had
    /// it as one of its own: its citations, and its row in any project, now
    /// show this work. By its title, or its file's name when it has none.
    Attached {
        needs_ingest: bool,
        merged: Option<String>,
    },
    /// The file already is the work, or one of its files, and was known at
    /// that path already.
    AlreadyIts,
    /// The file already is one of the work's, found somewhere new: the place
    /// is recorded, so a file the File tab reported missing can be found again.
    /// `needs_ingest` when it hasn't been read, or failed.
    FoundAgain { needs_ingest: bool },
    /// The file is a work with files of its own. Attaching it would move them
    /// all to this work, which is merging two sources, not attaching a file.
    HasFiles(Option<String>),
    /// The file belongs to another work, named by its title when it has one.
    /// Moving it between works silently would change what that work's
    /// citations open, so it's refused.
    Elsewhere(Option<String>),
    /// The library has no work by that id.
    NoWork,
}

/// Attach the file `sha256`, found at `path`, to the work `work` (M1b-7).
///
/// Registers the file as ingest would, then makes it an alias of the work, in
/// one transaction: a file registered but never attached would sit in the
/// library in no project, and the next attempt would find it "already there".
/// The file's chunks and metadata stay under its own hash; the work's details
/// are what's cited.
pub async fn attach_file(
    library: &SqlitePool,
    work: &str,
    sha256: &str,
    path: &str,
    file_name: &str,
) -> Result<Attach, String> {
    let mut tx = library.begin().await.map_err(|e| e.to_string())?;

    let work: String = sqlx::query_scalar(
        "SELECT COALESCE((SELECT canonical FROM source_aliases WHERE alias = ?1), ?1)",
    )
    .bind(work)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    let known: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sources WHERE sha256 = ?)")
        .bind(&work)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    if !known {
        return Ok(Attach::NoWork);
    }

    let title = |id: String| async move {
        sqlx::query_scalar::<_, Option<String>>(
            "SELECT json_extract(csl_json, '$.title') FROM sources WHERE sha256 = ?",
        )
        .bind(id)
        .fetch_optional(library)
        .await
        .map(Option::flatten)
        .map_err(|e| e.to_string())
    };

    let owner: Option<String> =
        sqlx::query_scalar("SELECT canonical FROM source_aliases WHERE alias = ?")
            .bind(sha256)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    if let Some(owner) = owner.as_ref().filter(|owner| **owner != work) {
        let owner = owner.clone();
        drop(tx);
        return Ok(Attach::Elsewhere(title(owner).await?));
    }
    // Already the work's. Picked again from somewhere it wasn't known to be,
    // which is how a file the File tab reports missing is found: keep the place.
    if owner.is_some() || sha256 == work {
        let seen: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM locations WHERE sha256 = ? AND path = ?)",
        )
        .bind(sha256)
        .bind(path)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        if seen {
            return Ok(Attach::AlreadyIts);
        }
        register_source_on(&mut tx, sha256, path, file_name).await?;
        let needs_ingest = needs_ingest_on(&mut tx, sha256).await?;
        tx.commit().await.map_err(|e| e.to_string())?;
        return Ok(Attach::FoundAgain { needs_ingest });
    }

    // A work with files attached to it isn't a file to attach: the alias
    // would carry its files across too, and change what they open as in
    // every project, as moving a file from another work would.
    let has_files: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM source_aliases WHERE canonical = ?)")
            .bind(sha256)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    if has_files {
        drop(tx);
        return Ok(Attach::HasFiles(title(sha256.to_string()).await?));
    }

    // A file the library already has is a source of its own, in whichever
    // project found it: it becomes this work, the merge ADR 003 describes,
    // and is said whether or not it was ever resolved to details.
    let merged: Option<String> = sqlx::query_scalar(
        "SELECT COALESCE(json_extract(csl_json, '$.title'), '') FROM sources WHERE sha256 = ?",
    )
    .bind(sha256)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    register_source_on(&mut tx, sha256, path, file_name).await?;
    alias_source_on(&mut tx, sha256, &work).await?;
    let needs_ingest = needs_ingest_on(&mut tx, sha256).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(Attach::Attached {
        needs_ingest,
        merged: merged.map(|t| {
            if t.is_empty() {
                file_name.to_string()
            } else {
                t
            }
        }),
    })
}

/// Whether the file `sha256` is still to be read: never read, or failed.
async fn needs_ingest_on(tx: &mut SqliteConnection, sha256: &str) -> Result<bool, String> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM ingest_status
                        WHERE sha256 = ? AND state IN ('pending', 'failed'))",
    )
    .bind(sha256)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())
}

/// One file of a work, for its sidebar's File tab (M1b-7 AC-3).
#[derive(Debug, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct SourceFile {
    /// The file's own hash: the work's id, or an attached file's.
    pub sha256: String,
    pub file_name: String,
    /// Where it was last found, or where it was last seen when it can't be
    /// found anywhere now.
    pub path: String,
    /// False when no place it was seen still has a file.
    pub found: bool,
    /// Its ingest state: whether it has been read yet, or failed.
    pub state: String,
    pub last_error: Option<String>,
}

/// Every file of the work `id` belongs to, with every place each was seen,
/// newest first: the work's own file, then those attached to it by name.
pub async fn source_file_locations(
    library: &SqlitePool,
    id: &str,
) -> Result<Vec<(SourceFile, Vec<(String, String)>)>, String> {
    let group = work_and_files(library, id).await?;
    let work = group[0].clone();
    let mut files = Vec::new();
    for sha256 in group {
        let seen: Vec<(String, String)> = sqlx::query_as(
            "SELECT path, file_name FROM locations WHERE sha256 = ? ORDER BY last_seen DESC, path",
        )
        .bind(&sha256)
        .fetch_all(library)
        .await
        .map_err(|e| e.to_string())?;
        let Some((path, file_name)) = seen.first().cloned() else {
            continue;
        };
        let (state, last_error): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT state, last_error FROM ingest_status WHERE sha256 = ?")
                .bind(&sha256)
                .fetch_optional(library)
                .await
                .map_err(|e| e.to_string())?
                .unwrap_or((None, None));
        files.push((
            SourceFile {
                sha256,
                file_name,
                path,
                found: false,
                state: state.unwrap_or_else(|| "pending".into()),
                last_error,
            },
            seen,
        ));
    }
    // Attached files have no order of their own; their hashes' would look random.
    let attached = usize::from(files.first().is_some_and(|(f, _)| f.sha256 == work));
    files[attached..].sort_by(|(a, _), (b, _)| a.file_name.cmp(&b.file_name));
    Ok(files)
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
///
/// Resolves to the ids removed: the work's, then its files'.
pub async fn remove_source(library: &SqlitePool, id: &str) -> Result<Vec<String>, String> {
    let group = work_and_files(library, id).await?;
    sqlx::query("DELETE FROM sources WHERE sha256 IN (SELECT value FROM json_each(?))")
        .bind(serde_json::to_string(&group).map_err(|e| e.to_string())?)
        .execute(library)
        .await
        .map_err(|e| e.to_string())?;
    Ok(group)
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
    vector_rows(library, None).await
}

/// The rows a write may have changed, as the library has them now (M2-2):
/// those `changed` covers, and those under `held`, the keys the index holds
/// for it, wherever they've moved to.
pub async fn index_rows_for(
    library: &SqlitePool,
    changed: &[Changed],
    held: &[Key],
) -> Result<Vec<IndexRow>, String> {
    let mut wanted = Wanted::default();
    for change in changed {
        match change {
            Changed::Owner(o) => {
                wanted.chunks.insert(o);
                wanted.marks.owners.insert(o);
                wanted.notes.owners.insert(o);
            }
            Changed::ChunksOf(o) => {
                wanted.chunks.insert(o);
            }
            Changed::AnnotationsOf(o) => {
                wanted.marks.owners.insert(o);
            }
            Changed::SourceNotesOf(o) => {
                wanted.notes.owners.insert(o);
            }
            Changed::Annotation(id) => {
                wanted.marks.ids.insert(id);
            }
            Changed::SourceNote(id) => {
                wanted.notes.ids.insert(id);
            }
        }
    }
    for key in held {
        match key {
            Key::Chunk { sha256, .. } => wanted.chunks.insert(sha256),
            Key::Annotation(id) => wanted.marks.ids.insert(id),
            Key::SourceNote(id) => wanted.notes.ids.insert(id),
        };
    }
    vector_rows(library, Some(&wanted)).await
}

/// Which rows `vector_rows` reads: chunks by file, and marks and notes by
/// owner or by id.
#[derive(Default)]
struct Wanted<'a> {
    chunks: BTreeSet<&'a String>,
    marks: ByOwnerOrId<'a>,
    notes: ByOwnerOrId<'a>,
}

#[derive(Default)]
struct ByOwnerOrId<'a> {
    owners: BTreeSet<&'a String>,
    ids: BTreeSet<&'a String>,
}

fn json(set: &BTreeSet<&String>) -> Result<String, String> {
    serde_json::to_string(set).map_err(|e| e.to_string())
}

/// Rows with a vector: all of them, or those `wanted` names.
async fn vector_rows(
    library: &SqlitePool,
    wanted: Option<&Wanted<'_>>,
) -> Result<Vec<IndexRow>, String> {
    let mut rows = Vec::new();

    let chunks = "SELECT sha256, idx, embedding FROM chunks";
    let chunks = match wanted {
        None => sqlx::query(chunks).fetch_all(library).await,
        Some(w) if w.chunks.is_empty() => Ok(Vec::new()),
        Some(w) => {
            sqlx::query(&format!(
                "{chunks} WHERE sha256 IN (SELECT value FROM json_each(?))"
            ))
            .bind(json(&w.chunks)?)
            .fetch_all(library)
            .await
        }
    };
    for r in chunks.map_err(|e| e.to_string())? {
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

    rows.extend(
        marks_or_notes(
            library,
            "SELECT t.id, t.sha256, e.embedding
               FROM annotations t JOIN annotation_embeddings e ON e.id = t.id",
            Key::Annotation,
            wanted.map(|w| &w.marks),
        )
        .await?,
    );
    rows.extend(
        marks_or_notes(
            library,
            "SELECT t.id, t.sha256, e.embedding
               FROM source_notes t JOIN source_note_embeddings e ON e.id = t.id",
            Key::SourceNote,
            wanted.map(|w| &w.notes),
        )
        .await?,
    );
    Ok(rows)
}

/// Marks or source notes with a vector, which are read alike: all of them, or
/// those on the files or works `wanted` names, or with its ids.
async fn marks_or_notes(
    library: &SqlitePool,
    sql: &str,
    key: fn(String) -> Key,
    wanted: Option<&ByOwnerOrId<'_>>,
) -> Result<Vec<IndexRow>, String> {
    let found = match wanted {
        None => sqlx::query(sql).fetch_all(library).await,
        Some(w) if w.owners.is_empty() && w.ids.is_empty() => Ok(Vec::new()),
        Some(w) => {
            sqlx::query(&format!(
                "{sql} WHERE t.sha256 IN (SELECT value FROM json_each(?1))
                       OR t.id IN (SELECT value FROM json_each(?2))"
            ))
            .bind(json(&w.owners)?)
            .bind(json(&w.ids)?)
            .fetch_all(library)
            .await
        }
    };
    Ok(found
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|r| IndexRow {
            key: key(r.get("id")),
            owner: r.get("sha256"),
            embedding: unpack_embedding(&r.get::<Vec<u8>, _>("embedding")),
        })
        .collect())
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
    /// How to name the work: its title, else its file's name. A book entered
    /// by hand has no file, so a note can't be named the way a mark is.
    pub title: Option<String>,
}

/// The columns a source note search reads, with the work's name alongside.
/// `json_valid` first: `json_extract` on a malformed record is an error, and
/// one bad record would sink the whole search.
const SOURCE_NOTE_SEARCH_SELECT: &str = "SELECT n.id, n.sha256, n.body, n.quote, n.page_label,
            n.label_id, n.created_at, n.updated_at,
            COALESCE(
              (SELECT json_extract(s.csl_json, '$.title') FROM sources s
                WHERE s.sha256 = n.sha256 AND json_valid(s.csl_json)),
              (SELECT l.file_name FROM locations l WHERE l.sha256 = n.sha256
                ORDER BY l.last_seen DESC LIMIT 1)) AS title
       FROM source_notes n";

fn scored_note_from(
    row: &sqlx::sqlite::SqliteRow,
    similarity: f32,
    source_id: String,
    in_project: bool,
) -> ScoredSourceNote {
    ScoredSourceNote {
        note: source_note_from(row),
        similarity,
        source_id,
        in_project,
        // A title that isn't a string is no name at all.
        title: row.try_get::<Option<String>, _>("title").ok().flatten(),
    }
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
            Key::SourceNote(id) => {
                sqlx::query(&format!("{SOURCE_NOTE_SEARCH_SELECT} WHERE n.id = ?"))
                    .bind(id)
                    .fetch_optional(library)
                    .await
                    .map_err(|e| e.to_string())?
                    .map(|r| {
                        Hit::SourceNote(scored_note_from(
                            &r,
                            found.similarity,
                            source_id,
                            found.in_project,
                        ))
                    })
            }
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

/* ------------------------------------------------------------ source notes */

/// A source note on its way in (M1b-8, ADR 004). The id is the caller's, as a
/// mark's is, so a note keeps it through an export and back.
#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct NewSourceNote {
    pub id: String,
    /// Any of the work's ids: the note is kept under the work's own.
    pub sha256: String,
    /// Markdown. May be empty when there's a quote.
    pub body: String,
    #[specta(optional)]
    pub quote: Option<String>,
    /// The page as the paper prints it.
    #[specta(optional)]
    pub page_label: Option<String>,
    #[specta(optional)]
    pub label_id: Option<String>,
}

/// Everything noted on a work (UX-3's Notes tab): its own notes, and the marks
/// on each of its files (ADR 003), so a book's tab shows the highlights made in
/// the PDF attached to it.
#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct WorkNotes {
    /// In the order they were first written.
    pub notes: Vec<SourceNote>,
    /// File by file, in the order of `files`, and by page within each: sheet 3
    /// of a scan and sheet 3 of a preprint aren't the same page.
    pub marks: Vec<Annotation>,
    /// The files the marks are on: the work's own first, then by name.
    pub files: Vec<NotedFile>,
}

/// A file a work's marks are on, named as it was last seen.
#[derive(Debug, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct NotedFile {
    pub sha256: String,
    pub file_name: String,
}

const SOURCE_NOTE_COLUMNS: &str =
    "id, sha256, body, quote, page_label, label_id, created_at, updated_at";

fn source_note_from(row: &sqlx::sqlite::SqliteRow) -> SourceNote {
    SourceNote {
        id: row.get("id"),
        sha256: row.get("sha256"),
        body: row.get("body"),
        quote: row.get("quote"),
        page_label: row.get("page_label"),
        label_id: row.get("label_id"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

/// The notes and marks on a work, by any of its ids.
pub async fn work_notes(library: &SqlitePool, id: &str) -> Result<WorkNotes, String> {
    let work = canonical(library, id).await?;
    let notes = sqlx::query(&format!(
        "SELECT {SOURCE_NOTE_COLUMNS} FROM source_notes
          WHERE sha256 = ? ORDER BY created_at, rowid"
    ))
    .bind(&work)
    .fetch_all(library)
    .await
    .map_err(|e| e.to_string())?;
    // The work's own file, then each attached file by name.
    let files: Vec<NotedFile> = sqlx::query_as::<_, (String, String)>(
        "SELECT f.sha256,
                (SELECT file_name FROM locations l WHERE l.sha256 = f.sha256
                  ORDER BY last_seen DESC LIMIT 1) AS file_name
           FROM (SELECT ?1 AS sha256
                 UNION SELECT alias FROM source_aliases WHERE canonical = ?1) f
          WHERE EXISTS (SELECT 1 FROM locations l WHERE l.sha256 = f.sha256)
          ORDER BY f.sha256 <> ?1, file_name, f.sha256",
    )
    .bind(&work)
    .fetch_all(library)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .map(|(sha256, file_name)| NotedFile { sha256, file_name })
    .collect();
    let rank = |sha: &str| {
        files
            .iter()
            .position(|f| f.sha256 == sha)
            .unwrap_or(files.len())
    };

    let mut marks: Vec<Annotation> = sqlx::query(&format!(
        "SELECT {ANNOTATION_COLUMNS} FROM annotations
          WHERE sha256 = ?1
             OR sha256 IN (SELECT alias FROM source_aliases WHERE canonical = ?1)
          ORDER BY page, created_at"
    ))
    .bind(&work)
    .fetch_all(library)
    .await
    .map_err(|e| e.to_string())?
    .iter()
    .map(annotation_from)
    .collect();
    // Stable, so each file's marks stay in page order.
    marks.sort_by_key(|m| rank(&m.sha256));

    Ok(WorkNotes {
        notes: notes.iter().map(source_note_from).collect(),
        marks,
        files,
    })
}

/// Save a source note, or replace one. Resolves false when the library has no
/// such work.
///
/// Kept under the work's canonical id, which `alias_source` keeps true from
/// then on. Editing a note leaves it on the work it was written on.
pub async fn save_source_note(library: &SqlitePool, note: &NewSourceNote) -> Result<bool, String> {
    // The work is found in the same statement that writes the note: looked up
    // first, an alias recorded in between would leave the note on an id that
    // had just stopped being a work, where no Notes tab reads.
    let saved = sqlx::query(
        "INSERT INTO source_notes (id, sha256, body, quote, page_label, label_id)
         SELECT ?, sha256, ?, ?, ?, ? FROM sources
          WHERE sha256 = COALESCE((SELECT canonical FROM source_aliases WHERE alias = ?6), ?6)
         ON CONFLICT(id) DO UPDATE SET
            body       = excluded.body,
            quote      = excluded.quote,
            page_label = excluded.page_label,
            label_id   = excluded.label_id,
            updated_at = CURRENT_TIMESTAMP",
    )
    .bind(&note.id)
    .bind(&note.body)
    .bind(&note.quote)
    .bind(&note.page_label)
    .bind(&note.label_id)
    .bind(&note.sha256)
    .execute(library)
    .await
    .map_err(|e| e.to_string())?;
    Ok(saved.rows_affected() > 0)
}

/// Delete a source note, and its embedding with it (the foreign key cascades).
pub async fn delete_source_note(library: &SqlitePool, id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM source_notes WHERE id = ?")
        .bind(id)
        .execute(library)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// A source note with its work's name: what the notes export writes out.
#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct NamedSourceNote {
    #[serde(flatten)]
    pub note: SourceNote,
    /// How to name the work, as a search result names it. The export can't
    /// name it from the open project alone: the notes are the whole library's.
    pub title: Option<String>,
}

/// Every source note in the library, each work's together, oldest first: what
/// the notes export writes out beside the marks (M1b-8 AC-5).
pub async fn all_source_notes(library: &SqlitePool) -> Result<Vec<NamedSourceNote>, String> {
    Ok(sqlx::query(&format!(
        "{SOURCE_NOTE_SEARCH_SELECT} ORDER BY n.sha256, n.created_at, n.rowid"
    ))
    .fetch_all(library)
    .await
    .map_err(|e| e.to_string())?
    .iter()
    .map(|row| NamedSourceNote {
        note: source_note_from(row),
        title: row.try_get::<Option<String>, _>("title").ok().flatten(),
    })
    .collect())
}

/// The text a source note is embedded from: the words quoted, then what was
/// thought of them (ADR 004), joined as a mark's are so the two read alike to
/// the model.
pub fn source_note_text(quote: Option<&str>, body: &str) -> String {
    let quote = quote.unwrap_or("").trim();
    let body = body.trim();
    match (quote.is_empty(), body.is_empty()) {
        (false, false) => format!("{quote} \u{2014} {body}"),
        (false, true) => quote.to_string(),
        _ => body.to_string(),
    }
}

/// A source note's words as they were read, and the text and hash they make:
/// what an embedding is made from, and what it's kept against.
#[derive(Debug, Clone, PartialEq)]
pub struct NoteToEmbed {
    pub id: String,
    pub body: String,
    pub quote: Option<String>,
    pub text: String,
    pub hash: String,
}

/// The note in a row of `id, body, quote, text_hash`, when its vector is
/// missing or was made from other words.
fn note_to_embed_from(row: &sqlx::sqlite::SqliteRow) -> Option<NoteToEmbed> {
    let body: String = row.get("body");
    let quote: Option<String> = row.get("quote");
    let text = source_note_text(quote.as_deref(), &body);
    if text.is_empty() {
        return None;
    }
    let hash = text_hash(&text);
    let embedded: Option<String> = row.get("text_hash");
    (embedded.as_deref() != Some(hash.as_str())).then(|| NoteToEmbed {
        id: row.get("id"),
        body,
        quote,
        text,
        hash,
    })
}

/// A source note to embed, when its vector is missing or was made from other
/// words. `None` when there's nothing to embed: the note is gone, says
/// nothing, or was embedded from exactly this.
///
/// Read from the library rather than handed in, so what's embedded is what was
/// saved, trimmed and all.
pub async fn source_note_to_embed(
    library: &SqlitePool,
    id: &str,
) -> Result<Option<NoteToEmbed>, String> {
    let row = sqlx::query(
        "SELECT n.id, n.body, n.quote, e.text_hash
           FROM source_notes n LEFT JOIN source_note_embeddings e ON e.id = n.id
          WHERE n.id = ?",
    )
    .bind(id)
    .fetch_optional(library)
    .await
    .map_err(|e| e.to_string())?;
    Ok(row.as_ref().and_then(note_to_embed_from))
}

/// The SHA-256 of some text, as hex: what an embedding's `text_hash` records.
pub fn text_hash(text: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Store a source note's vector, with the hash of the text it came from, if
/// the note still says what it said when it was read. False when it doesn't,
/// or is gone.
///
/// Inference takes seconds, and the note can be saved again meanwhile. Kept
/// unconditionally, the slower of two embeds would win, and a vector of the
/// older words would stand under their hash. The words are compared in the
/// same statement that writes, so nothing lands between the check and the
/// write.
pub async fn save_source_note_embedding(
    library: &SqlitePool,
    note: &NoteToEmbed,
    embedding: &[f32],
) -> Result<bool, String> {
    // The WHERE also settles SQLite's upsert-after-SELECT parsing ambiguity.
    let saved = sqlx::query(
        "INSERT INTO source_note_embeddings (id, embedding, text_hash)
         SELECT id, ?2, ?3 FROM source_notes WHERE id = ?1 AND body = ?4 AND quote IS ?5
         ON CONFLICT(id) DO UPDATE SET
            embedding = excluded.embedding, text_hash = excluded.text_hash",
    )
    .bind(&note.id)
    .bind(pack_embedding(embedding))
    .bind(&note.hash)
    .bind(&note.body)
    .bind(&note.quote)
    .execute(library)
    .await
    .map_err(|e| e.to_string())?;
    Ok(saved.rows_affected() > 0)
}

/// Source notes whose vector is missing or was made from other words: what
/// "Prepare my notes" embeds. `annotations_needing_embedding` for notes, but
/// the hash is the real one, so a backfilled note isn't embedded again until
/// its words change, and one whose re-embedding failed after an edit is.
///
/// The hash is SHA-256, which SQLite can't compute, so every note is read and
/// compared here. A library holds a few thousand at most, and this runs when
/// asked, not as anyone types.
pub async fn source_notes_needing_embedding(
    library: &SqlitePool,
    limit: usize,
) -> Result<Vec<NoteToEmbed>, String> {
    let rows = sqlx::query(
        "SELECT n.id, n.body, n.quote, e.text_hash
           FROM source_notes n
           LEFT JOIN source_note_embeddings e ON e.id = n.id
          ORDER BY n.created_at, n.rowid",
    )
    .fetch_all(library)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .filter_map(note_to_embed_from)
        .take(limit)
        .collect())
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

/// `%query%` for a LIKE with `ESCAPE '\'`, the query's own `%`, `_` and `\`
/// taken literally. The backslash goes first: escaped after the others, it
/// would double their escapes, and left alone, a query ending in one would
/// escape the closing `%` and find nothing.
fn like_pattern(query: &str) -> String {
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

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
    let pattern = like_pattern(query);
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

/// Find notes of either kind, marks and source notes, by the words in them
/// (ADR 004: no surface special-cases either).
///
/// Each kind is asked as `search_annotations_literally` asks for marks, and the
/// two lists are merged the same way: the project's first, then the newest.
/// Both tables stamp `created_at` as SQLite's `CURRENT_TIMESTAMP`, so the
/// dates compare as they stand.
pub async fn search_notes_literally(
    pool: &SqlitePool,
    query: &str,
    project_hashes: &[String],
    limit: i64,
) -> Result<Vec<Hit>, String> {
    let marks = search_annotations_literally(pool, query, project_hashes, limit).await?;

    let pattern = like_pattern(query);
    let aliases = alias_map(pool).await?;
    let in_set: std::collections::HashSet<&str> = project_hashes
        .iter()
        .map(|id| resolve(&aliases, id))
        .collect();
    let project = serde_json::to_string(&in_set).map_err(|e| e.to_string())?;
    // A note's `sha256` is already its work's (ADR 004), resolved again only in
    // case an alias landed since.
    let notes = sqlx::query(&format!(
        "{SOURCE_NOTE_SEARCH_SELECT}
          WHERE ?3 OR n.body LIKE ?1 ESCAPE '\\' OR n.quote LIKE ?1 ESCAPE '\\'
          ORDER BY COALESCE((SELECT canonical FROM source_aliases WHERE alias = n.sha256), n.sha256)
                   IN (SELECT value FROM json_each(?4)) DESC,
                   n.created_at DESC
          LIMIT ?2"
    ))
    .bind(&pattern)
    .bind(limit)
    .bind(query.is_empty())
    .bind(&project)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut hits: Vec<Hit> = marks.into_iter().map(Hit::Annotation).collect();
    hits.extend(notes.iter().map(|row| {
        let source_id = resolve(&aliases, row.get::<&str, _>("sha256")).to_string();
        let in_project = in_set.contains(source_id.as_str());
        Hit::SourceNote(scored_note_from(row, 1.0, source_id, in_project))
    }));
    let key = |hit: &Hit| match hit {
        Hit::Annotation(mark) => (mark.in_project, mark.annotation.created_at.clone()),
        Hit::SourceNote(note) => (note.in_project, note.note.created_at.clone()),
        Hit::Chunk(chunk) => (chunk.in_project, String::new()),
    };
    // Stable, so two notes made in the same second keep their kind's order.
    hits.sort_by_key(|hit| std::cmp::Reverse(key(hit)));
    hits.truncate(limit.max(0) as usize);
    Ok(hits)
}

/// Find notes of either kind by what they are about: the index, asked for
/// marks and source notes together, across the library with the project's
/// first.
pub async fn search_notes_in(
    index: &Index,
    pool: &SqlitePool,
    query_embedding: &[f32],
    project_hashes: &[String],
    limit: usize,
) -> Result<Vec<Hit>, String> {
    search_index(
        index,
        pool,
        query_embedding,
        project_hashes,
        &[HitKind::Annotation, HitKind::SourceNote],
        limit,
        true,
    )
    .await
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
