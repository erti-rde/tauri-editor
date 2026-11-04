//! Reading Zotero's database, from a copy (ADR 012).
//!
//! Zotero keeps `zotero.sqlite` in WAL mode and holds a lock on it while it
//! runs, so it can't be opened where it is. Copied with its `-wal`, it can.
//! The copy is checked before it's trusted: Zotero may write while it's taken,
//! and the tables Erti reads must be the ones it knows.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;

use crate::ipc::{AppError, ErrorKind};

pub const DB_FILE: &str = "zotero.sqlite";
const WAL_FILE: &str = "zotero.sqlite-wal";

pub const BUSY: &str = "Zotero is busy. Try again in a moment.";
pub const UNREADABLE: &str =
    "This version of Zotero stores its library in a way Erti can\u{2019}t read yet.";

/// Every table and column read below. Checked before any query, so a Zotero
/// that reshapes them gets a sentence rather than a wrong or empty tree.
const LAYOUT: &[(&str, &[&str])] = &[
    ("libraries", &["libraryID", "type"]),
    ("groups", &["groupID", "libraryID", "name"]),
    (
        "collections",
        &[
            "collectionID",
            "collectionName",
            "parentCollectionID",
            "libraryID",
            "key",
        ],
    ),
    ("collectionItems", &["collectionID", "itemID", "orderIndex"]),
    ("items", &["itemID", "itemTypeID", "libraryID", "key"]),
    ("itemTypesCombined", &["itemTypeID", "typeName"]),
    ("fieldsCombined", &["fieldID", "fieldName"]),
    (
        "baseFieldMappingsCombined",
        &["itemTypeID", "baseFieldID", "fieldID"],
    ),
    ("itemData", &["itemID", "fieldID", "valueID"]),
    ("itemDataValues", &["valueID", "value"]),
    (
        "creators",
        &["creatorID", "firstName", "lastName", "fieldMode"],
    ),
    (
        "itemCreators",
        &["itemID", "creatorID", "creatorTypeID", "orderIndex"],
    ),
    ("creatorTypes", &["creatorTypeID", "creatorType"]),
    (
        "itemAttachments",
        &["itemID", "parentItemID", "linkMode", "contentType", "path"],
    ),
    ("deletedItems", &["itemID"]),
    ("deletedCollections", &["collectionID"]),
];

/// A paper as the tree shows it: anything but a note, an annotation, an
/// attachment of another item, a standalone file that isn't a PDF, or what's
/// in Zotero's bin. `i` is the `items` row.
pub const PAPER: &str = "i.itemID NOT IN (SELECT itemID FROM deletedItems)
    AND i.itemTypeID NOT IN
        (SELECT itemTypeID FROM itemTypesCombined WHERE typeName IN ('note', 'annotation'))
    AND NOT EXISTS (
        SELECT 1 FROM itemAttachments a
        WHERE a.itemID = i.itemID
          AND (a.parentItemID IS NOT NULL OR a.contentType IS NOT 'application/pdf')
    )";

/// Collections in Zotero's bin.
pub const BINNED_COLLECTIONS: &str = "SELECT collectionID FROM deletedCollections";

/// Size and time of Zotero's two files: the same before and after a copy means
/// Zotero didn't write while it was taken.
type Stamp = [(u64, Option<SystemTime>); 2];

async fn stamp(data: &Path) -> Stamp {
    let of = |name: &'static str| {
        let path = data.join(name);
        async move {
            match tokio::fs::metadata(&path).await {
                Ok(meta) => (meta.len(), meta.modified().ok()),
                Err(_) => (0, None),
            }
        }
    };
    [of(DB_FILE).await, of(WAL_FILE).await]
}

/// The copy last taken of each data folder, reused while Zotero's files are as
/// they were: expanding a collection shouldn't copy the library again.
fn taken() -> &'static Mutex<HashMap<PathBuf, (Stamp, PathBuf)>> {
    static TAKEN: OnceLock<Mutex<HashMap<PathBuf, (Stamp, PathBuf)>>> = OnceLock::new();
    TAKEN.get_or_init(Default::default)
}

/// A checked copy of Zotero's database, open read-only.
pub struct Snapshot {
    pub pool: SqlitePool,
}

impl Snapshot {
    pub async fn close(self) {
        self.pool.close().await;
    }
}

async fn connect(copy: &Path, read_only: bool) -> Result<SqlitePool, sqlx::Error> {
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(copy)
                .read_only(read_only)
                .create_if_missing(false),
        )
        .await
}

/// Open the database in `data`, as Zotero last wrote it.
///
/// Copied into `cache`, checked with `quick_check` and against [`LAYOUT`]. A
/// copy Zotero wrote to while it was taken is taken again, once; then it's
/// [`BUSY`] (M1b-11 AC-7). A layout Erti doesn't know is [`UNREADABLE`]
/// (AC-11).
pub async fn open(data: &Path, cache: &Path) -> Result<Snapshot, AppError> {
    let source = data.join(DB_FILE);
    if !tokio::fs::try_exists(&source).await.unwrap_or(false) {
        return Err(AppError::new(
            ErrorKind::NotFound,
            "Erti didn\u{2019}t find Zotero\u{2019}s library where it was. Locate Zotero\u{2019}s data folder again.",
        ));
    }

    let now = stamp(data).await;
    let reuse = {
        let taken = taken().lock().unwrap_or_else(|e| e.into_inner());
        taken
            .get(data)
            .filter(|(at, _)| *at == now)
            .map(|(_, copy)| copy.clone())
    };
    if let Some(copy) = reuse {
        if let Ok(pool) = connect(&copy, true).await {
            return Ok(Snapshot { pool });
        }
    }

    for _ in 0..2 {
        let dir = cache
            .join("zotero")
            .join(format!("{}-{}", std::process::id(), uuid_ish()));
        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(|e| AppError::from_io(&e, &dir))?;
        let copy = dir.join(DB_FILE);

        let before = stamp(data).await;
        tokio::fs::copy(&source, &copy)
            .await
            .map_err(|e| AppError::from_io(&e, &source))?;
        match tokio::fs::copy(data.join(WAL_FILE), dir.join(WAL_FILE)).await {
            Ok(_) => {}
            // No WAL is a library Zotero has checkpointed and closed.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(AppError::from_io(&e, &data.join(WAL_FILE))),
        }
        let after = stamp(data).await;
        if before != after {
            let _ = tokio::fs::remove_dir_all(&dir).await;
            continue;
        }

        // Opened writable once, so SQLite folds the WAL into the copy and the
        // copy leaves WAL mode: a read-only connection to a WAL database needs
        // files beside it that this one then doesn't. It's Erti's copy, never
        // Zotero's file.
        let checked = match connect(&copy, false).await {
            Ok(pool) => {
                let ok: Result<String, _> = sqlx::query_scalar("PRAGMA quick_check")
                    .fetch_one(&pool)
                    .await;
                let folded: Result<String, _> = sqlx::query_scalar("PRAGMA journal_mode = DELETE")
                    .fetch_one(&pool)
                    .await;
                pool.close().await;
                matches!(ok.as_deref(), Ok("ok")) && folded.is_ok()
            }
            Err(_) => false,
        };
        if !checked {
            let _ = tokio::fs::remove_dir_all(&dir).await;
            continue;
        }

        let pool = connect(&copy, true).await.map_err(|_| busy())?;
        if !layout_is_known(&pool).await {
            pool.close().await;
            let _ = tokio::fs::remove_dir_all(&dir).await;
            return Err(AppError::new(ErrorKind::InvalidInput, UNREADABLE));
        }

        let old = {
            let mut taken = taken().lock().unwrap_or_else(|e| e.into_inner());
            taken.insert(data.to_path_buf(), (after, copy))
        };
        if let Some((_, old)) = old {
            if let Some(parent) = old.parent() {
                // A reader may still have it open; on Windows that keeps it
                // until it's done, which is fine.
                let _ = tokio::fs::remove_dir_all(parent).await;
            }
        }
        return Ok(Snapshot { pool });
    }
    Err(busy())
}

fn busy() -> AppError {
    AppError::new(ErrorKind::Conflict, BUSY)
}

/// Enough to keep two copies taken at once apart.
fn uuid_ish() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("{nanos:x}-{}", NEXT.fetch_add(1, Ordering::Relaxed))
}

async fn layout_is_known(pool: &SqlitePool) -> bool {
    for (table, columns) in LAYOUT {
        let present: Vec<String> = match sqlx::query_scalar("SELECT name FROM pragma_table_info(?)")
            .bind(table)
            .fetch_all(pool)
            .await
        {
            Ok(present) => present,
            Err(_) => return false,
        };
        if columns.iter().any(|c| !present.iter().any(|p| p == c)) {
            return false;
        }
    }
    true
}

/// A library as Erti names it: `user`, or `group:<groupID>`. Zotero's own
/// `libraryID` is this machine's; the group's id is the same everywhere.
pub async fn library_id(pool: &SqlitePool, library: &str) -> Result<i64, AppError> {
    let found: Option<i64> = if library == "user" {
        sqlx::query_scalar("SELECT libraryID FROM libraries WHERE type = 'user' LIMIT 1")
            .fetch_optional(pool)
            .await
            .map_err(|e| AppError::new(ErrorKind::Database, e.to_string()))?
    } else if let Some(group) = library
        .strip_prefix("group:")
        .and_then(|g| g.parse::<i64>().ok())
    {
        sqlx::query_scalar("SELECT libraryID FROM groups WHERE groupID = ?")
            .bind(group)
            .fetch_optional(pool)
            .await
            .map_err(|e| AppError::new(ErrorKind::Database, e.to_string()))?
    } else {
        None
    };
    found.ok_or_else(|| {
        AppError::new(
            ErrorKind::NotFound,
            "That Zotero library isn\u{2019}t on this computer any more.",
        )
    })
}

pub fn db_error(e: sqlx::Error) -> AppError {
    AppError::new(ErrorKind::Database, format!("Could not read Zotero: {e}"))
}

/// Libraries with their names, user first, then groups by name.
pub async fn libraries(pool: &SqlitePool) -> Result<Vec<(i64, String, String)>, AppError> {
    let rows = sqlx::query(
        "SELECT l.libraryID, l.type, g.groupID, g.name
         FROM libraries l LEFT JOIN groups g ON g.libraryID = l.libraryID
         WHERE l.type = 'user' OR (l.type = 'group' AND g.groupID IS NOT NULL)
         ORDER BY l.type = 'group', g.name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await
    .map_err(db_error)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let id: i64 = row.get(0);
            let kind: String = row.get(1);
            if kind == "user" {
                (id, "user".to_string(), "My Library".to_string())
            } else {
                let group: i64 = row.get(2);
                (id, format!("group:{group}"), row.get::<String, _>(3))
            }
        })
        .collect())
}

/// One collection row: id, parent, key, name, papers directly in it.
pub struct CollectionRow {
    pub id: i64,
    pub parent: Option<i64>,
    pub key: String,
    pub name: String,
    pub papers: i64,
}

pub async fn collections(pool: &SqlitePool, library: i64) -> Result<Vec<CollectionRow>, AppError> {
    let sql = format!(
        "SELECT c.collectionID, c.parentCollectionID, c.key, c.collectionName,
            (SELECT COUNT(*) FROM collectionItems ci JOIN items i ON i.itemID = ci.itemID
             WHERE ci.collectionID = c.collectionID AND {PAPER})
         FROM collections c
         WHERE c.libraryID = ? AND c.collectionID NOT IN ({BINNED_COLLECTIONS})
         ORDER BY c.collectionName COLLATE NOCASE"
    );
    let rows = sqlx::query(&sql)
        .bind(library)
        .fetch_all(pool)
        .await
        .map_err(db_error)?;
    Ok(rows
        .into_iter()
        .map(|row| CollectionRow {
            id: row.get(0),
            parent: row.get(1),
            key: row.get(2),
            name: row.get(3),
            papers: row.get(4),
        })
        .collect())
}

/// Papers in no collection that isn't in the bin. One whose only collection
/// is in the bin is unfiled here, where it can still be found and ticked.
fn unfiled_sql() -> String {
    format!(
        "SELECT i.itemID FROM items i
         WHERE i.libraryID = ? AND {PAPER}
           AND NOT EXISTS (
             SELECT 1 FROM collectionItems ci
             WHERE ci.itemID = i.itemID AND ci.collectionID NOT IN ({BINNED_COLLECTIONS})
           )"
    )
}

pub async fn count_papers(pool: &SqlitePool, library: i64) -> Result<(i64, i64), AppError> {
    let all: i64 = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM items i WHERE i.libraryID = ? AND {PAPER}"
    ))
    .bind(library)
    .fetch_one(pool)
    .await
    .map_err(db_error)?;
    let unfiled: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM ({})", unfiled_sql()))
        .bind(library)
        .fetch_one(pool)
        .await
        .map_err(db_error)?;
    Ok((all, unfiled))
}

/// The papers a pick stands for, by `itemID`.
pub async fn pick_items(
    pool: &SqlitePool,
    library: i64,
    kind: &str,
    key: Option<&str>,
) -> Result<Vec<i64>, AppError> {
    let ids = match (kind, key) {
        ("library", _) => sqlx::query_scalar(&format!(
            "SELECT i.itemID FROM items i WHERE i.libraryID = ? AND {PAPER}"
        ))
        .bind(library)
        .fetch_all(pool)
        .await,
        ("unfiled", _) => {
            sqlx::query_scalar(&unfiled_sql())
                .bind(library)
                .fetch_all(pool)
                .await
        }
        // A collection is everything under it, its subcollections too
        // (M1b-11 AC-4), but nothing under one in the bin.
        ("collection", Some(key)) => sqlx::query_scalar(&format!(
            "WITH RECURSIVE under(id) AS (
                SELECT collectionID FROM collections
                WHERE libraryID = ? AND key = ? AND collectionID NOT IN ({BINNED_COLLECTIONS})
                UNION
                SELECT c.collectionID FROM collections c JOIN under ON c.parentCollectionID = under.id
                WHERE c.collectionID NOT IN ({BINNED_COLLECTIONS})
             )
             SELECT DISTINCT i.itemID FROM collectionItems ci
             JOIN under ON ci.collectionID = under.id
             JOIN items i ON i.itemID = ci.itemID
             WHERE {PAPER}"
        ))
        .bind(library)
        .bind(key)
        .fetch_all(pool)
        .await,
        ("item", Some(key)) => sqlx::query_scalar(&format!(
            "SELECT i.itemID FROM items i WHERE i.libraryID = ? AND i.key = ? AND {PAPER}"
        ))
        .bind(library)
        .bind(key)
        .fetch_all(pool)
        .await,
        _ => {
            return Err(AppError::new(
                ErrorKind::InvalidInput,
                "That isn\u{2019}t something in Zotero.",
            ))
        }
    };
    ids.map_err(db_error)
}

/// The papers directly in a collection, or a library's unfiled ones.
pub async fn papers_in(
    pool: &SqlitePool,
    library: i64,
    collection: Option<&str>,
) -> Result<Vec<i64>, AppError> {
    match collection {
        None => sqlx::query_scalar(&unfiled_sql())
            .bind(library)
            .fetch_all(pool)
            .await
            .map_err(db_error),
        Some(key) => sqlx::query_scalar(&format!(
            "SELECT i.itemID FROM collectionItems ci
             JOIN collections c ON c.collectionID = ci.collectionID
             JOIN items i ON i.itemID = ci.itemID
             WHERE c.libraryID = ? AND c.key = ? AND {PAPER}
             ORDER BY ci.orderIndex"
        ))
        .bind(library)
        .bind(key)
        .fetch_all(pool)
        .await
        .map_err(db_error),
    }
}

/// An item's own row: key and type.
pub struct ItemRow {
    pub id: i64,
    pub key: String,
    pub item_type: String,
}

fn ids_json(ids: &[i64]) -> String {
    serde_json::to_string(ids).unwrap_or_else(|_| "[]".into())
}

pub async fn items(pool: &SqlitePool, ids: &[i64]) -> Result<Vec<ItemRow>, AppError> {
    let rows = sqlx::query(
        "SELECT i.itemID, i.key, t.typeName FROM items i
         JOIN itemTypesCombined t ON t.itemTypeID = i.itemTypeID
         WHERE i.itemID IN (SELECT value FROM json_each(?))",
    )
    .bind(ids_json(ids))
    .fetch_all(pool)
    .await
    .map_err(db_error)?;
    let by_id: HashMap<i64, ItemRow> = rows
        .into_iter()
        .map(|row| {
            let id: i64 = row.get(0);
            (
                id,
                ItemRow {
                    id,
                    key: row.get(1),
                    item_type: row.get(2),
                },
            )
        })
        .collect();
    // In the order asked for: a collection's own order, or the pick's.
    let mut by_id = by_id;
    Ok(ids.iter().filter_map(|id| by_id.remove(id)).collect())
}

/// Each item's fields: (item, field, base field if it has one, value). A
/// type-specific field ("bookTitle") comes with the base it's a kind of
/// ("publicationTitle"), which is what Zotero's CSL map is written in.
pub async fn fields(
    pool: &SqlitePool,
    ids: &[i64],
) -> Result<Vec<(i64, String, Option<String>, String)>, AppError> {
    let rows = sqlx::query(
        "SELECT d.itemID, f.fieldName, b.fieldName, CAST(v.value AS TEXT)
         FROM itemData d
         JOIN items i ON i.itemID = d.itemID
         JOIN fieldsCombined f ON f.fieldID = d.fieldID
         JOIN itemDataValues v ON v.valueID = d.valueID
         LEFT JOIN baseFieldMappingsCombined m
           ON m.itemTypeID = i.itemTypeID AND m.fieldID = d.fieldID
         LEFT JOIN fieldsCombined b ON b.fieldID = m.baseFieldID
         WHERE d.itemID IN (SELECT value FROM json_each(?))",
    )
    .bind(ids_json(ids))
    .fetch_all(pool)
    .await
    .map_err(db_error)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            (
                row.get(0),
                row.get(1),
                row.get(2),
                row.get::<Option<String>, _>(3).unwrap_or_default(),
            )
        })
        .collect())
}

/// Each item's creators, in order: (item, type, first, last, one field).
pub async fn creators(
    pool: &SqlitePool,
    ids: &[i64],
) -> Result<Vec<(i64, String, String, String, bool)>, AppError> {
    let rows = sqlx::query(
        "SELECT ic.itemID, ct.creatorType, COALESCE(c.firstName, ''), COALESCE(c.lastName, ''),
                COALESCE(c.fieldMode, 0)
         FROM itemCreators ic
         JOIN creators c ON c.creatorID = ic.creatorID
         JOIN creatorTypes ct ON ct.creatorTypeID = ic.creatorTypeID
         WHERE ic.itemID IN (SELECT value FROM json_each(?))
         ORDER BY ic.itemID, ic.orderIndex",
    )
    .bind(ids_json(ids))
    .fetch_all(pool)
    .await
    .map_err(db_error)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            (
                row.get(0),
                row.get(1),
                row.get(2),
                row.get(3),
                row.get::<i64, _>(4) == 1,
            )
        })
        .collect())
}

/// A PDF attachment: (the paper it's for, its own key, link mode, path).
/// A standalone PDF is its own paper.
pub struct PdfRow {
    pub paper: i64,
    pub key: String,
    pub link_mode: i64,
    pub path: Option<String>,
}

pub async fn pdfs(pool: &SqlitePool, ids: &[i64]) -> Result<Vec<PdfRow>, AppError> {
    let rows = sqlx::query(
        "SELECT COALESCE(a.parentItemID, a.itemID), ai.key, COALESCE(a.linkMode, -1), a.path
         FROM itemAttachments a
         JOIN items ai ON ai.itemID = a.itemID
         WHERE a.contentType = 'application/pdf'
           AND a.itemID NOT IN (SELECT itemID FROM deletedItems)
           AND COALESCE(a.parentItemID, a.itemID) IN (SELECT value FROM json_each(?))
         ORDER BY a.itemID",
    )
    .bind(ids_json(ids))
    .fetch_all(pool)
    .await
    .map_err(db_error)?;
    Ok(rows
        .into_iter()
        .map(|row| PdfRow {
            paper: row.get(0),
            key: row.get(1),
            link_mode: row.get(2),
            path: row.get(3),
        })
        .collect())
}

/// One PDF attachment found by its key, in a library.
pub async fn pdf_by_key(
    pool: &SqlitePool,
    library: i64,
    key: &str,
) -> Result<Option<PdfRow>, AppError> {
    let row = sqlx::query(
        "SELECT COALESCE(a.parentItemID, a.itemID), ai.key, COALESCE(a.linkMode, -1), a.path
         FROM itemAttachments a
         JOIN items ai ON ai.itemID = a.itemID
         WHERE ai.libraryID = ? AND ai.key = ? AND a.contentType = 'application/pdf'
           AND a.itemID NOT IN (SELECT itemID FROM deletedItems)
           AND (a.parentItemID IS NULL
                OR a.parentItemID NOT IN (SELECT itemID FROM deletedItems))",
    )
    .bind(library)
    .bind(key)
    .fetch_optional(pool)
    .await
    .map_err(db_error)?;
    Ok(row.map(|row| PdfRow {
        paper: row.get(0),
        key: row.get(1),
        link_mode: row.get(2),
        path: row.get(3),
    }))
}

/// Where a PDF attachment is, or why Erti can't attach it.
pub enum Place {
    File(PathBuf),
    Not(&'static str),
}

pub const NOT_DOWNLOADED: &str = "Zotero hasn\u{2019}t downloaded this PDF to this computer.";
pub const IN_BASE_FOLDER: &str =
    "It\u{2019}s in the folder Zotero keeps linked files in, which Erti can\u{2019}t see yet.";
const DAMAGED: &str = "Zotero\u{2019}s record of this PDF is damaged.";
const NOT_A_FILE: &str = "It\u{2019}s a link, not a file.";

/// Resolve an attachment's path as Zotero records it (ADR 012).
///
/// `storage:<name>` is Zotero's own copy, at `<data>/storage/<key>/<name>`,
/// and must stay inside `storage` once symlinks are followed. A linked file is
/// where Zotero says. `attachments:` is relative to a folder Zotero keeps in
/// its profile, not its data folder, so Erti can't find it.
pub async fn place(data: &Path, pdf: &PdfRow) -> Place {
    let path = pdf.path.as_deref().unwrap_or_default();
    let file = match pdf.link_mode {
        0 | 1 => {
            let Some(name) = path.strip_prefix("storage:") else {
                return Place::Not(DAMAGED);
            };
            if name.is_empty() || name.contains(['/', '\\']) || name == ".." || !is_key(&pdf.key) {
                return Place::Not(DAMAGED);
            }
            data.join("storage").join(&pdf.key).join(name)
        }
        2 => {
            if path.starts_with("attachments:") {
                return Place::Not(IN_BASE_FOLDER);
            }
            if crate::scope::refused_form(path) {
                return Place::Not(DAMAGED);
            }
            PathBuf::from(path)
        }
        _ => return Place::Not(NOT_A_FILE),
    };
    let Ok(canonical) = tokio::fs::canonicalize(&file).await else {
        return Place::Not(NOT_DOWNLOADED);
    };
    if pdf.link_mode != 2 {
        let Ok(storage) = tokio::fs::canonicalize(data.join("storage")).await else {
            return Place::Not(NOT_DOWNLOADED);
        };
        if !canonical.starts_with(&storage) {
            return Place::Not(DAMAGED);
        }
    }
    Place::File(canonical)
}

/// A Zotero key: eight of Zotero's own letters and digits.
pub fn is_key(key: &str) -> bool {
    key.len() == 8
        && key
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
}
