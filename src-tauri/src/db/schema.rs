//! Schema for the two databases.
//!
//! Sources live in one library; manuscripts live with the project. A researcher's
//! corpus is reused across papers, so embedding a PDF once and citing it from
//! anywhere is the behaviour that matters. Meanwhile a project folder should stay
//! something you can copy, sync or hand to a supervisor.
//!
//! Everything Phases 2-4 need is here from the start — chunk page/section columns,
//! ingest status, embedding provenance — so the corpus is re-ingested once rather
//! than once per phase.

/// Schema version applied to a freshly created or upgraded database.
pub const LIBRARY_VERSION: i64 = 1;
pub const PROJECT_VERSION: i64 = 1;

/// The shared source corpus. Lives at a user-configurable location, defaulting to
/// `~/Erti/library.db`, the way Zotero exposes its data directory.
pub const LIBRARY_SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;

-- One row per distinct PDF, keyed by the SHA-256 of its bytes.
--
-- Content addressing rather than filename is what makes the same paper in two
-- project folders a single entry, embedded once. It also removes the UNIQUE
-- filename collision that silently dropped files, survives renames and moves,
-- and gives duplicate detection for free.
CREATE TABLE IF NOT EXISTS sources (
    sha256       TEXT PRIMARY KEY,
    csl_json     TEXT,            -- CSL-JSON as returned by doi.org; NULL until resolved
    zotero_type  TEXT,
    doi          TEXT,
    resolved_via TEXT,            -- 'pdf-doi' | 'pdf-arxiv' | 'crossref' | 'manual'
    resolved_at  TIMESTAMP,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Every path a given hash has been seen at. PDFs are never copied into the
-- library: this records where they live, Zotero's "linked files" model. A source
-- whose file has moved or been deleted still cites correctly; only "open PDF"
-- degrades.
CREATE TABLE IF NOT EXISTS locations (
    sha256    TEXT NOT NULL,
    path      TEXT NOT NULL,
    file_name TEXT NOT NULL,
    last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (sha256, path),
    FOREIGN KEY (sha256) REFERENCES sources(sha256) ON DELETE CASCADE
);

-- Extracted text, chunked for retrieval.
--
-- page_start/page_end and the character offsets are what make "jump to the exact
-- place in the PDF" possible (#37); `section` lets a result say "p. 4, Results"
-- instead of showing a bare sentence. Phase 2 fills them in properly.
--
-- `embedding` is a packed little-endian f32 array, NOT JSON. Measured on the old
-- schema, JSON text cost 4702 bytes per 384-dim vector against 1536 packed, and
-- embeddings were 96% of the stored payload.
CREATE TABLE IF NOT EXISTS chunks (
    sha256     TEXT NOT NULL,
    idx        INTEGER NOT NULL,
    text       TEXT NOT NULL,
    page_start INTEGER,
    page_end   INTEGER,
    section    TEXT,
    char_start INTEGER,
    char_end   INTEGER,
    embedding  BLOB NOT NULL,
    PRIMARY KEY (sha256, idx),
    FOREIGN KEY (sha256) REFERENCES sources(sha256) ON DELETE CASCADE
);

-- Ingest outcome per source.
--
-- The old pipeline registered a file before processing it and deduplicated on the
-- filename already being present, so anything that failed once was never retried:
-- 41% of the dev corpus sat permanently unprocessed and invisible. A source is
-- only 'ready' once it genuinely succeeded, and failures stay visible and
-- retryable.
CREATE TABLE IF NOT EXISTS ingest_status (
    sha256       TEXT PRIMARY KEY,
    state        TEXT NOT NULL CHECK (state IN ('pending', 'ready', 'failed')),
    attempts     INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT,
    last_attempt TIMESTAMP,
    FOREIGN KEY (sha256) REFERENCES sources(sha256) ON DELETE CASCADE
);

-- Which model produced the vectors in `chunks`.
--
-- Embeddings from different models occupy different vector spaces; mixing them
-- yields silently meaningless similarities. Recording provenance makes a model
-- change a detectable migration rather than quiet corruption.
CREATE TABLE IF NOT EXISTS embedding_meta (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    model_id   TEXT NOT NULL,
    dims       INTEGER NOT NULL,
    revision   TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_locations_path ON locations(path);
CREATE INDEX IF NOT EXISTS idx_sources_doi ON sources(doi);
CREATE INDEX IF NOT EXISTS idx_ingest_state ON ingest_status(state);
"#;

/// Per-project database, stored at `<project>/.erti/project.db`.
pub const PROJECT_SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;

-- Manuscripts in this project. Replaces the single hardcoded magnum_opus.json,
-- which allowed exactly one document per project (#57).
CREATE TABLE IF NOT EXISTS documents (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    filename   TEXT NOT NULL UNIQUE,
    title      TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Which library sources belong to this project.
--
-- This is the "prioritise the PDFs by project" mechanism: search ranks this set
-- first, while the rest of the library stays discoverable and one click away.
-- Adding a source here costs nothing — its chunks already exist in the library.
CREATE TABLE IF NOT EXISTS source_set (
    sha256   TEXT PRIMARY KEY,
    added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Project-local metadata corrections layered over the library's CSL-JSON, so
-- fixing a wrong author for one paper does not silently rewrite it everywhere.
CREATE TABLE IF NOT EXISTS metadata_overrides (
    sha256     TEXT PRIMARY KEY,
    csl_json   TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Single-row project settings.
CREATE TABLE IF NOT EXISTS settings (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    csl_style  TEXT,
    csl_locale TEXT NOT NULL DEFAULT 'en-GB'
);

INSERT OR IGNORE INTO settings (id) VALUES (1);
"#;
