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
pub const LIBRARY_VERSION: i64 = 5;
pub const PROJECT_VERSION: i64 = 1;

/// One step up to schema version `to`.
///
/// **Every database is built only from these, new ones included.** There is no
/// separate "create it fresh" path, and that is deliberate: two paths to the
/// same schema drift apart the moment someone edits one of them, and the
/// version that drifts is invisible — `CREATE TABLE IF NOT EXISTS` does nothing
/// at all to a table that already exists, so a table added to a create-fresh
/// script would appear for new users and never for anyone who already had a
/// library, with no error either way. A new database is just one that has run
/// every migration.
///
/// **A migration that has shipped must never be edited.** Someone's library was
/// built by it and cannot be rebuilt. Corrections come as another migration.
/// `shipped_migrations_are_frozen` fingerprints each one, so an edit fails the
/// build rather than a user's library.
pub struct Migration {
    pub to: i64,
    pub sql: &'static str,
    /// A query that returns a row once this migration has already been applied.
    ///
    /// Migrations have to be safe to re-run, because there is no transaction
    /// around an upgrade and one that fails partway runs again next time. Most
    /// of them manage that on their own with `IF NOT EXISTS`. `ALTER TABLE ADD
    /// COLUMN` cannot — SQLite has no `IF NOT EXISTS` for it and errors on a
    /// duplicate column — so those declare a check instead, and the runner skips
    /// them when it comes back true.
    pub skip_if: Option<&'static str>,
}

pub const LIBRARY_MIGRATIONS: &[Migration] = &[
    Migration {
        to: 2,
        sql: LIBRARY_SCHEMA,
        skip_if: None,
    },
    Migration {
        to: 3,
        sql: ANNOTATIONS_SCHEMA,
        skip_if: None,
    },
    Migration {
        to: 4,
        sql: MARK_STYLE_SCHEMA,
        skip_if: Some("SELECT 1 FROM pragma_table_info('annotations') WHERE name = 'style'"),
    },
    Migration {
        to: 5,
        sql: PAGE_LABEL_SCHEMA,
        skip_if: Some("SELECT 1 FROM pragma_table_info('annotations') WHERE name = 'page_label'"),
    },
];

pub const PROJECT_MIGRATIONS: &[Migration] = &[Migration {
    to: 1,
    sql: PROJECT_SCHEMA,
    skip_if: None,
}];

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

-- Metadata salvaged from the pre-hybrid database.
--
-- The old `files` table recorded only a filename, never a path, so there is no
-- way to locate those PDFs and hash them: the migration cannot map old rows onto
-- new sources by itself. What it can do is carry the metadata forward keyed by
-- filename and apply it when a file of that name is next ingested, which saves
-- re-fetching work that already succeeded.
--
-- Only rows with genuinely resolved metadata are imported. The old database was
-- mostly '{}' placeholders that look resolved and never get retried, and
-- importing those would recreate exactly that problem.
CREATE TABLE IF NOT EXISTS legacy_metadata (
    file_name   TEXT PRIMARY KEY,
    csl_json    TEXT NOT NULL,
    imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    consumed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_locations_path ON locations(path);
CREATE INDEX IF NOT EXISTS idx_sources_doi ON sources(doi);
CREATE INDEX IF NOT EXISTS idx_ingest_state ON ingest_status(state);
"#;

/// Reading marks, and where reading stopped.
///
/// Kept in the library rather than in a project, and keyed by the content hash,
/// so a paper marked up for one piece of writing is still marked up when it is
/// opened for the next. That is what content-addressing was for, and notes are
/// the thing researchers most expect to follow a paper around.
///
/// Written once and used twice: appended to `LIBRARY_SCHEMA` for a new database,
/// and as the version 3 migration for an existing one — so the two cannot say
/// different things.
pub const ANNOTATIONS_SCHEMA: &str = r#"
-- A highlight, an area snapshot, or a note pinned to a page.
--
-- Anchored two ways, because the two fail differently. `rects` is exact and
-- costs nothing to draw, but it is geometry and says nothing about what was
-- under it. `quote`, with the text either side, says exactly what was marked but
-- has to be searched for. Keeping both means a highlight draws immediately, can
-- be repaired when the geometry stops agreeing, and is searchable as text.
--
-- `id` is a uuid rather than an autoincrement integer because annotations export
-- to a sidecar and come back on another machine, where an integer would collide
-- with whatever already holds it.
CREATE TABLE IF NOT EXISTS annotations (
    id          TEXT PRIMARY KEY,
    sha256      TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('highlight', 'area', 'page-note')),
    label_id    TEXT,                          -- NULL is an unlabelled highlight
    page        INTEGER NOT NULL,
    rects       TEXT,                          -- JSON [{x,y,w,h}] in PDF user space
    quote       TEXT,
    prefix      TEXT,
    suffix      TEXT,
    char_start  INTEGER,
    char_end    INTEGER,
    note        TEXT,
    origin      TEXT NOT NULL DEFAULT 'erti' CHECK (origin IN ('erti', 'imported')),
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sha256) REFERENCES sources(sha256) ON DELETE CASCADE
);

-- Area snapshots, split off so that listing annotations never drags image bytes
-- across IPC and editing a note never rewrites a 200 KB row.
CREATE TABLE IF NOT EXISTS annotation_images (
    id  TEXT PRIMARY KEY,
    png BLOB NOT NULL,
    FOREIGN KEY (id) REFERENCES annotations(id) ON DELETE CASCADE
);

-- Same reasoning as embedding_meta: vectors from different models occupy
-- different spaces, and mixing them yields silently meaningless similarities.
-- `text_hash` is what stops an unchanged note being re-embedded on every save.
CREATE TABLE IF NOT EXISTS annotation_embeddings (
    id        TEXT PRIMARY KEY,
    embedding BLOB NOT NULL,
    text_hash TEXT NOT NULL,
    FOREIGN KEY (id) REFERENCES annotations(id) ON DELETE CASCADE
);

-- What each colour means. User-global rather than per-project: a researcher
-- reads the same way whatever they happen to be writing.
CREATE TABLE IF NOT EXISTS annotation_labels (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    colour   TEXT NOT NULL,                    -- 'H S% L%', as the theme tokens are
    position INTEGER NOT NULL,
    enabled  INTEGER NOT NULL DEFAULT 1
);

-- Where reading stopped. Keyed by hash, so it is the paper that is remembered
-- rather than the tab that happened to show it.
CREATE TABLE IF NOT EXISTS reading_positions (
    sha256  TEXT PRIMARY KEY,
    page    INTEGER NOT NULL,
    scroll  REAL,
    scale   TEXT,
    seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sha256) REFERENCES sources(sha256) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_annotations_source ON annotations(sha256, page);
CREATE INDEX IF NOT EXISTS idx_annotations_label ON annotations(label_id);

-- The labels a library starts with.
--
-- Seeded here, in the migration, because a migration runs exactly once per
-- database. Seeding on every open cannot work: `INSERT OR IGNORE` keyed on the
-- id does nothing to stop a deliberately deleted label coming back, because
-- deleting the row frees the id again. A researcher who removes `Definition`
-- because they never use it should not find it there again tomorrow. A ninth
-- label, if there is ever a good reason for one, ships as its own migration.
--
-- Six of these describe what a passage *is* — the moves a paper actually makes.
-- `Interesting` is neither claim nor judgement: it marks something worth coming
-- back to, which is how most future work starts. `My opinion` is deliberately
-- grey rather than a ninth hue, because it is the only label that is not about
-- the paper, and keeping the reader's own voice desaturated makes that
-- difference legible at a glance.
--
-- Colour is never the only channel — eight hues is past what stays separable
-- under deuteranopia, so the name travels with the annotation wherever it is
-- shown. Every one is renamable, recolourable and removable; this is only what
-- is there before anyone chooses otherwise.
INSERT OR IGNORE INTO annotation_labels (id, name, colour, position, enabled) VALUES
    ('claim',         'Claim',         '45 95% 62%',  0, 1),
    ('evidence',      'Evidence',      '145 50% 55%', 1, 1),
    ('method',        'Method',        '210 80% 65%', 2, 1),
    ('limitation',    'Limitation',    '5 80% 66%',   3, 1),
    ('definition',    'Definition',    '185 55% 52%', 4, 1),
    ('counter-point', 'Counter-point', '280 50% 68%', 5, 1),
    ('interesting',   'Interesting',   '325 70% 68%', 6, 1),
    ('my-opinion',    'My opinion',    '220 12% 62%', 7, 1);
"#;

/// How a mark is drawn over the words.
///
/// A highlight and an underline mark the same passage and mean the same thing —
/// they differ only in how heavy they look on the page, and readers use both for
/// the same reason they use two pens. So this is a column on `annotations`
/// rather than another `kind`: `kind` says what sort of thing was marked, and an
/// underline is still a marked passage.
///
/// A column rather than a new CHECK on `kind` also avoids rebuilding the table.
/// SQLite cannot alter a CHECK constraint in place, so widening `kind` would
/// mean creating a new table, copying every mark across and swapping them — real
/// risk, on the one table holding work that cannot be regenerated.
pub const MARK_STYLE_SCHEMA: &str = r#"
ALTER TABLE annotations ADD COLUMN style TEXT NOT NULL DEFAULT 'fill'
    CHECK (style IN ('fill', 'underline'));
"#;

/// The page number as the paper prints it.
///
/// `page` is where the mark is in the file: the eleventh sheet of the PDF. A
/// journal article that begins on page 843 calls that sheet 853, and 853 is what
/// a citation has to say — "Smith 2020, p. 11" points at nothing a reader of the
/// journal can find.
///
/// Kept per mark rather than as an offset on the source, because the mapping is
/// not always arithmetic: front matter is numbered in roman, scanned volumes
/// restart at each issue, and offprints begin at 1. Zotero solves it the same
/// way, with a page label on the annotation and a menu item to set it.
///
/// Null means "the same as the sheet", which is right for the great majority of
/// PDFs and costs nothing to store.
pub const PAGE_LABEL_SCHEMA: &str = r#"
ALTER TABLE annotations ADD COLUMN page_label TEXT;
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
