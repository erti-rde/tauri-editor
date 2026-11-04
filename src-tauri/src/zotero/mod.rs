//! A project from Zotero (M1b-11, ADR 012, docs/ux.md UX-13).
//!
//! Erti reads the person's Zotero library from a copy of its database
//! (`read.rs`) and never takes a path into Zotero from the webview: the data
//! folder is the one Erti found itself or the user picked, and every PDF is
//! named by Zotero's key and found from the database. What a project follows
//! and what it has from there are in the project (`zotero_follow`,
//! `zotero_imported`), so a sync later adds only what's new.

pub mod read;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::{queries, DbState};
use crate::db_commands::AttachedFile;
use crate::ipc::{AppError, Classify, ErrorKind};

use read::{Place, Snapshot};

/// Where Erti may look: the home folder Zotero's default is in, and Erti's own
/// cache, where the copies go.
#[derive(Clone, Debug)]
pub struct Env {
    pub home: Option<PathBuf>,
    pub cache: PathBuf,
}

fn env(app: &tauri::AppHandle) -> Result<Env, AppError> {
    use tauri::Manager;
    Ok(Env {
        home: app.path().home_dir().ok(),
        cache: app
            .path()
            .app_cache_dir()
            .map_err(|e| AppError::internal(format!("no cache folder: {e}")))?,
    })
}

/// The most papers read at once: a whole library of 20,000 is a minute's
/// import, and more is better done a part at a time.
pub const READ_LIMIT: usize = 20_000;
/// The most things picked or PDFs attached in one call.
pub const PICK_LIMIT: usize = 1_000;
pub const ATTACH_BATCH: usize = 200;

pub const NOT_FOUND: &str = "Erti didn\u{2019}t find Zotero on this computer.";
pub const NOT_LINKED: &str = "Erti doesn\u{2019}t know where Zotero keeps its library yet.";
pub const NOT_PICKED: &str =
    "Choose Zotero\u{2019}s data folder with \u{201c}Locate Zotero data folder\u{2026}\u{201d} to let Erti read it.";
pub const NO_LIBRARY: &str = "That folder has no Zotero library in it. Zotero shows its data folder under Settings \u{203a} Advanced \u{203a} Files and Folders.";

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct ZoteroStatus {
    /// The data folder Erti reads, once linked.
    pub linked: Option<String>,
    /// Zotero's default data folder, when there's a library in it.
    pub detected: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct ZoteroLibrary {
    /// `user`, or `group:<groupID>`.
    pub id: String,
    pub name: String,
    pub papers: u32,
    /// Papers in no collection.
    pub unfiled: u32,
    pub collections: Vec<ZoteroCollection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct ZoteroCollection {
    pub key: String,
    pub name: String,
    /// Papers directly in it, not in its subcollections.
    pub papers: u32,
    pub children: Vec<ZoteroCollection>,
}

/// A paper as a row of the tree.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct ZoteroPaper {
    pub key: String,
    pub title: String,
    /// "Smith", "Smith & Jones", "Smith et al.", or empty.
    pub creators: String,
    pub year: Option<String>,
    pub pdfs: u32,
}

/// Something ticked in the tree: a whole library, a collection with
/// everything under it, a library's unfiled papers, or one paper.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct ZoteroPick {
    pub library: String,
    /// `library`, `collection`, `unfiled` or `item`.
    pub kind: String,
    #[specta(optional)]
    pub key: Option<String>,
    /// Zotero's name for it, for the Sources line.
    #[specta(optional)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct ZoteroField {
    pub name: String,
    /// The base field it's a kind of, when it's type-specific.
    pub base: Option<String>,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct ZoteroCreator {
    pub creator_type: String,
    pub first_name: String,
    pub last_name: String,
    /// One field: an organisation, or a name Zotero keeps whole.
    pub single: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct ZoteroPdf {
    pub key: String,
    pub file_name: String,
    /// Why it can't be attached; none when it can.
    pub reason: Option<String>,
}

/// A paper read in full, for importing.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct ZoteroItem {
    pub library: String,
    pub key: String,
    pub item_type: String,
    pub fields: Vec<ZoteroField>,
    pub creators: Vec<ZoteroCreator>,
    pub pdfs: Vec<ZoteroPdf>,
}

/// A PDF to attach: Zotero's key for it, and the work it's for.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct ZoteroAttach {
    pub work: String,
    pub library: String,
    pub key: String,
}

#[derive(Debug, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct ZoteroAttached {
    pub key: String,
    pub work: String,
    /// Where it is, once attached.
    pub path: Option<String>,
    pub file: Option<AttachedFile>,
    pub reason: Option<String>,
}

/// Which work a Zotero paper became.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct ZoteroRecord {
    pub library: String,
    pub key: String,
    pub work: String,
}

/// What a sync would do (M1b-11 AC-8).
#[derive(Debug, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct ZoteroSyncPlan {
    /// Papers in what the project follows that it hasn't got.
    pub items: Vec<ZoteroItem>,
    /// PDFs Zotero has for papers the project has, not yet attached.
    pub pdfs: Vec<ZoteroAttach>,
    /// Papers the project got from Zotero that it no longer follows there.
    /// They stay in the project.
    pub gone: u32,
}

// ---------------------------------------------------------------------------
// Where Zotero is.

/// Zotero's default data folder, if there's a library in it.
pub async fn detected(env: &Env) -> Option<PathBuf> {
    let folder = env.home.as_ref()?.join("Zotero");
    let there = tokio::fs::try_exists(folder.join(read::DB_FILE))
        .await
        .unwrap_or(false);
    if there {
        tokio::fs::canonicalize(&folder).await.ok()
    } else {
        None
    }
}

async fn linked(state: &DbState) -> Result<Option<PathBuf>, AppError> {
    let library = state.library().await?;
    let dir = queries::zotero_data_dir(&library).await.or_database()?;
    Ok(dir.map(PathBuf::from))
}

async fn data_dir(state: &DbState) -> Result<PathBuf, AppError> {
    linked(state)
        .await?
        .ok_or_else(|| AppError::new(ErrorKind::NotFound, NOT_LINKED))
}

async fn snapshot(state: &DbState, env: &Env) -> Result<(PathBuf, Snapshot), AppError> {
    let data = data_dir(state).await?;
    let snap = read::open(&data, &env.cache).await?;
    Ok((data, snap))
}

/// Shown, as a path, for the Sources line and the dialog.
fn shown(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[tauri::command]
#[specta::specta]
pub async fn zotero_status(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
) -> Result<ZoteroStatus, AppError> {
    zotero_status_in(&state, &env(&app)?).await
}

pub async fn zotero_status_in(state: &DbState, env: &Env) -> Result<ZoteroStatus, AppError> {
    let linked = match linked(state).await? {
        Some(dir)
            if tokio::fs::try_exists(dir.join(read::DB_FILE))
                .await
                .unwrap_or(false) =>
        {
            Some(shown(&dir))
        }
        _ => None,
    };
    Ok(ZoteroStatus {
        linked,
        detected: detected(env).await.as_deref().map(shown),
    })
}

/// Link Zotero's data folder (M1b-11 AC-2): the one Erti found when `path` is
/// none, or one the user picked in the dialog. Only a dialog pick: the project
/// folder, which a script can write to (T3), never holds a library Erti reads.
#[tauri::command]
#[specta::specta]
pub async fn zotero_link(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    path: Option<String>,
) -> Result<ZoteroStatus, AppError> {
    zotero_link_in(&state, &env(&app)?, path).await
}

pub async fn zotero_link_in(
    state: &DbState,
    env: &Env,
    path: Option<String>,
) -> Result<ZoteroStatus, AppError> {
    let folder = match path {
        None => detected(env)
            .await
            .ok_or_else(|| AppError::new(ErrorKind::NotFound, NOT_FOUND))?,
        Some(path) => {
            if crate::scope::refused_form(&path) {
                return Err(AppError::new(ErrorKind::PermissionDenied, NOT_PICKED));
            }
            let canonical = tokio::fs::canonicalize(&path)
                .await
                .map_err(|_| AppError::new(ErrorKind::PermissionDenied, NOT_PICKED))?;
            if !state.grants.cover(&canonical) {
                return Err(AppError::new(ErrorKind::PermissionDenied, NOT_PICKED));
            }
            if !tokio::fs::try_exists(canonical.join(read::DB_FILE))
                .await
                .unwrap_or(false)
            {
                return Err(AppError::new(ErrorKind::InvalidInput, NO_LIBRARY));
            }
            canonical
        }
    };
    let library = state.library().await?;
    queries::set_zotero_data_dir(&library, &shown(&folder))
        .await
        .or_database()?;
    zotero_status_in(state, env).await
}

// ---------------------------------------------------------------------------
// The tree.

#[tauri::command]
#[specta::specta]
pub async fn zotero_tree(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
) -> Result<Vec<ZoteroLibrary>, AppError> {
    zotero_tree_in(&state, &env(&app)?).await
}

/// The libraries and their collections, nested, without the bin (AC-3).
pub async fn zotero_tree_in(state: &DbState, env: &Env) -> Result<Vec<ZoteroLibrary>, AppError> {
    let (_, snap) = snapshot(state, env).await?;
    let result = tree(&snap).await;
    snap.close().await;
    result
}

async fn tree(snap: &Snapshot) -> Result<Vec<ZoteroLibrary>, AppError> {
    let mut out = Vec::new();
    for (id, reference, name) in read::libraries(&snap.pool).await? {
        let rows = read::collections(&snap.pool, id).await?;
        let (papers, unfiled) = read::count_papers(&snap.pool, id).await?;
        out.push(ZoteroLibrary {
            id: reference,
            name,
            papers: papers as u32,
            unfiled: unfiled as u32,
            collections: nest(rows),
        });
    }
    Ok(out)
}

/// Collections under their parents. One whose parent isn't there is under a
/// collection in the bin, and is left out with it.
fn nest(rows: Vec<read::CollectionRow>) -> Vec<ZoteroCollection> {
    let present: HashSet<i64> = rows.iter().map(|r| r.id).collect();
    let mut under: HashMap<Option<i64>, Vec<read::CollectionRow>> = HashMap::new();
    for row in rows {
        if row.parent.is_some_and(|p| !present.contains(&p)) {
            continue;
        }
        under.entry(row.parent).or_default().push(row);
    }
    fn build(
        parent: Option<i64>,
        under: &mut HashMap<Option<i64>, Vec<read::CollectionRow>>,
        depth: usize,
    ) -> Vec<ZoteroCollection> {
        // Zotero refuses a cycle; a damaged database might not.
        if depth > 64 {
            return Vec::new();
        }
        let Some(rows) = under.remove(&parent) else {
            return Vec::new();
        };
        rows.into_iter()
            .map(|row| ZoteroCollection {
                children: build(Some(row.id), under, depth + 1),
                key: row.key,
                name: row.name,
                papers: row.papers as u32,
            })
            .collect()
    }
    build(None, &mut under, 0)
}

fn checked_key(key: &str) -> Result<(), AppError> {
    if read::is_key(key) {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorKind::InvalidInput,
            "That isn\u{2019}t something in Zotero.",
        ))
    }
}

#[tauri::command]
#[specta::specta]
pub async fn zotero_items(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    library: String,
    collection: Option<String>,
) -> Result<Vec<ZoteroPaper>, AppError> {
    zotero_items_in(&state, &env(&app)?, &library, collection.as_deref()).await
}

/// The papers directly in a collection, or a library's unfiled ones, loaded as
/// the branch opens (AC-3).
pub async fn zotero_items_in(
    state: &DbState,
    env: &Env,
    library: &str,
    collection: Option<&str>,
) -> Result<Vec<ZoteroPaper>, AppError> {
    if let Some(key) = collection {
        checked_key(key)?;
    }
    let (_, snap) = snapshot(state, env).await?;
    let result = async {
        let id = read::library_id(&snap.pool, library).await?;
        let ids = read::papers_in(&snap.pool, id, collection).await?;
        papers(&snap, &ids).await
    }
    .await;
    snap.close().await;
    result
}

async fn papers(snap: &Snapshot, ids: &[i64]) -> Result<Vec<ZoteroPaper>, AppError> {
    let rows = read::items(&snap.pool, ids).await?;
    let mut titles: HashMap<i64, String> = HashMap::new();
    let mut years: HashMap<i64, String> = HashMap::new();
    for (item, name, base, value) in read::fields(&snap.pool, ids).await? {
        let is = |field: &str| name == field || base.as_deref() == Some(field);
        if is("title") {
            titles.insert(item, value);
        } else if is("date") {
            if let Some(year) = year_of(&value) {
                years.insert(item, year);
            }
        }
    }
    let mut names: HashMap<i64, Vec<String>> = HashMap::new();
    for (item, _, first, last, single) in read::creators(&snap.pool, ids).await? {
        let name = if single || last.is_empty() {
            first.clone() + &last
        } else {
            last
        };
        names.entry(item).or_default().push(name);
    }
    let mut pdfs: HashMap<i64, u32> = HashMap::new();
    for pdf in read::pdfs(&snap.pool, ids).await? {
        *pdfs.entry(pdf.paper).or_default() += 1;
    }
    let mut out: Vec<ZoteroPaper> = rows
        .into_iter()
        .map(|row| ZoteroPaper {
            title: titles
                .remove(&row.id)
                .filter(|t| !t.trim().is_empty())
                .unwrap_or_else(|| "Untitled".into()),
            creators: short_names(names.get(&row.id).map(Vec::as_slice).unwrap_or_default()),
            year: years.remove(&row.id),
            pdfs: pdfs.get(&row.id).copied().unwrap_or_default(),
            key: row.key,
        })
        .collect();
    out.sort_by_key(|p| p.title.to_lowercase());
    Ok(out)
}

/// The year in Zotero's stored date, "2019-03-00 March 2019".
fn year_of(stored: &str) -> Option<String> {
    let year = stored.get(0..4)?;
    (year.bytes().all(|b| b.is_ascii_digit()) && year != "0000").then(|| year.to_string())
}

fn short_names(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [one] => one.clone(),
        [one, two] => format!("{one} & {two}"),
        [one, ..] => format!("{one} et al."),
    }
}

// ---------------------------------------------------------------------------
// Reading what was ticked.

fn checked_picks(picks: &[ZoteroPick]) -> Result<(), AppError> {
    if picks.len() > PICK_LIMIT {
        return Err(AppError::new(
            ErrorKind::InvalidInput,
            format!("Choose at most {PICK_LIMIT} things at a time."),
        ));
    }
    for pick in picks {
        match (pick.kind.as_str(), pick.key.as_deref()) {
            ("library" | "unfiled", _) => {}
            ("collection" | "item", Some(key)) => checked_key(key)?,
            _ => {
                return Err(AppError::new(
                    ErrorKind::InvalidInput,
                    "That isn\u{2019}t something in Zotero.",
                ))
            }
        }
    }
    Ok(())
}

/// The papers the picks stand for, each once, in the order first met, with
/// the library each is in. Libraries no longer there are skipped when
/// `lenient`, as a sync must; refused otherwise.
async fn picked(
    snap: &Snapshot,
    picks: &[ZoteroPick],
    lenient: bool,
) -> Result<(Vec<i64>, HashMap<i64, String>), AppError> {
    let mut order = Vec::new();
    let mut library_of = HashMap::new();
    for pick in picks {
        let id = match read::library_id(&snap.pool, &pick.library).await {
            Ok(id) => id,
            Err(_) if lenient => continue,
            Err(e) => return Err(e),
        };
        for item in read::pick_items(&snap.pool, id, &pick.kind, pick.key.as_deref()).await? {
            if library_of.insert(item, pick.library.clone()).is_none() {
                order.push(item);
            }
        }
        if order.len() > READ_LIMIT {
            return Err(AppError::new(
                ErrorKind::InvalidInput,
                "That\u{2019}s more than 20,000 papers. Choose fewer at a time.",
            ));
        }
    }
    Ok((order, library_of))
}

/// Read papers in full: fields, creators, and their PDFs with where each is.
async fn assemble(
    snap: &Snapshot,
    data: &Path,
    ids: &[i64],
    library_of: &HashMap<i64, String>,
) -> Result<Vec<ZoteroItem>, AppError> {
    let mut fields: HashMap<i64, Vec<ZoteroField>> = HashMap::new();
    for (item, name, base, value) in read::fields(&snap.pool, ids).await? {
        let base = base.filter(|b| *b != name);
        fields
            .entry(item)
            .or_default()
            .push(ZoteroField { name, base, value });
    }
    let mut creators: HashMap<i64, Vec<ZoteroCreator>> = HashMap::new();
    for (item, creator_type, first_name, last_name, single) in
        read::creators(&snap.pool, ids).await?
    {
        creators.entry(item).or_default().push(ZoteroCreator {
            creator_type,
            first_name,
            last_name,
            single,
        });
    }
    let mut pdfs: HashMap<i64, Vec<ZoteroPdf>> = HashMap::new();
    for pdf in read::pdfs(&snap.pool, ids).await? {
        let place = read::place(data, &pdf).await;
        let file_name = pdf
            .path
            .as_deref()
            .map(|p| p.strip_prefix("storage:").unwrap_or(p))
            .map(|p| p.rsplit(['/', '\\']).next().unwrap_or(p).to_string())
            .unwrap_or_default();
        pdfs.entry(pdf.paper).or_default().push(ZoteroPdf {
            key: pdf.key,
            file_name,
            reason: match place {
                Place::File(_) => None,
                Place::Not(reason) => Some(reason.to_string()),
            },
        });
    }
    Ok(read::items(&snap.pool, ids)
        .await?
        .into_iter()
        .map(|row| ZoteroItem {
            library: library_of.get(&row.id).cloned().unwrap_or_default(),
            fields: fields.remove(&row.id).unwrap_or_default(),
            creators: creators.remove(&row.id).unwrap_or_default(),
            pdfs: pdfs.remove(&row.id).unwrap_or_default(),
            key: row.key,
            item_type: row.item_type,
        })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub async fn zotero_read(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    picks: Vec<ZoteroPick>,
) -> Result<Vec<ZoteroItem>, AppError> {
    zotero_read_in(&state, &env(&app)?, &picks).await
}

/// Everything the picks stand for, read for importing (AC-4, AC-5).
pub async fn zotero_read_in(
    state: &DbState,
    env: &Env,
    picks: &[ZoteroPick],
) -> Result<Vec<ZoteroItem>, AppError> {
    checked_picks(picks)?;
    let (data, snap) = snapshot(state, env).await?;
    let result = async {
        let (ids, library_of) = picked(&snap, picks, false).await?;
        assemble(&snap, &data, &ids, &library_of).await
    }
    .await;
    snap.close().await;
    result
}

// ---------------------------------------------------------------------------
// Attaching, following and syncing.

#[tauri::command]
#[specta::specta]
pub async fn zotero_attach(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    pdfs: Vec<ZoteroAttach>,
) -> Result<Vec<ZoteroAttached>, AppError> {
    zotero_attach_in(&state, &env(&app)?, pdfs).await
}

/// Attach PDFs where Zotero keeps them, found by their keys (AC-6). One that
/// can't be says why, and the rest go on.
pub async fn zotero_attach_in(
    state: &DbState,
    env: &Env,
    pdfs: Vec<ZoteroAttach>,
) -> Result<Vec<ZoteroAttached>, AppError> {
    if pdfs.len() > ATTACH_BATCH {
        return Err(AppError::new(
            ErrorKind::InvalidInput,
            format!("Attach at most {ATTACH_BATCH} PDFs at a time."),
        ));
    }
    for pdf in &pdfs {
        checked_key(&pdf.key)?;
    }
    let (data, snap) = snapshot(state, env).await?;
    let mut places = Vec::with_capacity(pdfs.len());
    for pdf in &pdfs {
        let place = match read::library_id(&snap.pool, &pdf.library).await {
            Ok(library) => match read::pdf_by_key(&snap.pool, library, &pdf.key).await {
                Ok(Some(row)) => read::place(&data, &row).await,
                Ok(None) => Place::Not("That PDF isn\u{2019}t in Zotero any more."),
                Err(e) => {
                    snap.close().await;
                    return Err(e);
                }
            },
            Err(_) => Place::Not("That Zotero library isn\u{2019}t on this computer any more."),
        };
        places.push(place);
    }
    snap.close().await;

    let mut out = Vec::with_capacity(pdfs.len());
    for (pdf, place) in pdfs.into_iter().zip(places) {
        let attached = match place {
            Place::Not(reason) => ZoteroAttached {
                key: pdf.key,
                work: pdf.work,
                path: None,
                file: None,
                reason: Some(reason.to_string()),
            },
            Place::File(path) => {
                let path = shown(&path);
                match crate::db_commands::attach_resolved(state, &pdf.work, path.clone()).await {
                    Ok(file) => ZoteroAttached {
                        key: pdf.key,
                        work: pdf.work,
                        path: Some(path),
                        file: Some(file),
                        reason: None,
                    },
                    Err(e) => ZoteroAttached {
                        key: pdf.key,
                        work: pdf.work,
                        path: Some(path),
                        file: None,
                        reason: Some(e.message),
                    },
                }
            }
        };
        out.push(attached);
    }
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn zotero_record(
    state: State<'_, DbState>,
    records: Vec<ZoteroRecord>,
) -> Result<(), AppError> {
    zotero_record_in(&state, records).await
}

/// Note which work each Zotero paper became, and put the works in the project,
/// those the library had already as well (AC-6).
pub async fn zotero_record_in(state: &DbState, records: Vec<ZoteroRecord>) -> Result<(), AppError> {
    if records.len() > READ_LIMIT {
        return Err(AppError::new(ErrorKind::InvalidInput, "Too many at once."));
    }
    for record in &records {
        checked_key(&record.key)?;
        if record.work.is_empty() || record.work.len() > 200 {
            return Err(AppError::new(
                ErrorKind::InvalidInput,
                "That isn\u{2019}t a source id.",
            ));
        }
    }
    let rows: Vec<queries::ImportedFromZotero> = records
        .into_iter()
        .map(|r| (r.library, r.key, r.work))
        .collect();
    queries::zotero_record(&state.project().await?, &rows)
        .await
        .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn zotero_follow(
    state: State<'_, DbState>,
    picks: Vec<ZoteroPick>,
) -> Result<(), AppError> {
    zotero_follow_in(&state, picks).await
}

/// Keep the project in step with these (AC-8).
pub async fn zotero_follow_in(state: &DbState, picks: Vec<ZoteroPick>) -> Result<(), AppError> {
    checked_picks(&picks)?;
    let rows: Vec<queries::Followed> = picks
        .into_iter()
        .map(|p| {
            let name: String = p.name.unwrap_or_default().chars().take(500).collect();
            (p.library, p.kind, p.key.unwrap_or_default(), name)
        })
        .collect();
    queries::zotero_follow(&state.project().await?, &rows)
        .await
        .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn zotero_following(state: State<'_, DbState>) -> Result<Vec<ZoteroPick>, AppError> {
    zotero_following_in(&state).await
}

pub async fn zotero_following_in(state: &DbState) -> Result<Vec<ZoteroPick>, AppError> {
    let rows = queries::zotero_following(&state.project().await?)
        .await
        .or_database()?;
    Ok(rows
        .into_iter()
        .map(|(library, kind, key, name)| ZoteroPick {
            library,
            kind,
            key: (!key.is_empty()).then_some(key),
            name: (!name.is_empty()).then_some(name),
        })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub async fn zotero_sync_plan(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
) -> Result<ZoteroSyncPlan, AppError> {
    zotero_sync_plan_in(&state, &env(&app)?).await
}

/// What's new in what the project follows (AC-8): papers it hasn't got, and
/// PDFs for the ones it has that aren't attached. Nothing is removed: a paper
/// gone from Zotero is only counted.
pub async fn zotero_sync_plan_in(state: &DbState, env: &Env) -> Result<ZoteroSyncPlan, AppError> {
    let follows = zotero_following_in(state).await?;
    let project = state.project().await?;
    let imported = queries::zotero_imported(&project).await.or_database()?;
    if follows.is_empty() {
        return Ok(ZoteroSyncPlan {
            items: Vec::new(),
            pdfs: Vec::new(),
            gone: 0,
        });
    }
    let had: HashMap<(String, String), String> = imported
        .into_iter()
        .map(|(library, key, work)| ((library, key), work))
        .collect();

    let (data, snap) = snapshot(state, env).await?;
    let result = async {
        let (ids, library_of) = picked(&snap, &follows, true).await?;
        let rows = read::items(&snap.pool, &ids).await?;
        let mut fresh = Vec::new();
        let mut kept = Vec::new();
        let mut current = HashSet::new();
        for row in &rows {
            let library = library_of.get(&row.id).cloned().unwrap_or_default();
            current.insert((library.clone(), row.key.clone()));
            match had.get(&(library, row.key.clone())) {
                Some(work) => kept.push((row.id, work.clone())),
                None => fresh.push(row.id),
            }
        }
        let items = assemble(&snap, &data, &fresh, &library_of).await?;

        let kept_ids: Vec<i64> = kept.iter().map(|(id, _)| *id).collect();
        let work_of: HashMap<i64, String> = kept.into_iter().collect();
        let library = state.library().await?;
        let mut pdfs = Vec::new();
        for pdf in read::pdfs(&snap.pool, &kept_ids).await? {
            let Place::File(path) = read::place(&data, &pdf).await else {
                continue;
            };
            if queries::location_recorded(&library, &shown(&path))
                .await
                .or_database()?
            {
                continue;
            }
            if let Some(work) = work_of.get(&pdf.paper) {
                pdfs.push(ZoteroAttach {
                    work: work.clone(),
                    library: library_of.get(&pdf.paper).cloned().unwrap_or_default(),
                    key: pdf.key,
                });
            }
        }
        let gone = had.keys().filter(|k| !current.contains(*k)).count() as u32;
        Ok(ZoteroSyncPlan { items, pdfs, gone })
    }
    .await;
    snap.close().await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn years_come_from_the_stored_part_of_a_date() {
        assert_eq!(year_of("2019-03-00 March 2019").as_deref(), Some("2019"));
        assert_eq!(year_of("0000-00-00 n.d."), None);
        assert_eq!(year_of(""), None);
        assert_eq!(year_of("Spring"), None);
    }

    #[test]
    fn creators_are_shortened_as_a_reference_list_would() {
        let names = |n: &[&str]| n.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(short_names(&names(&[])), "");
        assert_eq!(short_names(&names(&["Smith"])), "Smith");
        assert_eq!(short_names(&names(&["Smith", "Jones"])), "Smith & Jones");
        assert_eq!(
            short_names(&names(&["Smith", "Jones", "Lee"])),
            "Smith et al."
        );
    }

    #[test]
    fn zotero_keys_are_eight_of_its_letters_and_digits() {
        assert!(read::is_key("ABCD2345"));
        assert!(!read::is_key("abcd2345"));
        assert!(!read::is_key("ABC/../X"));
        assert!(!read::is_key("ABCD234"));
    }
}
