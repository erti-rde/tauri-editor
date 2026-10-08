//! Tauri commands for database access.
//!
//! These are the entire database surface available to the frontend. Nothing here
//! accepts SQL, which is what lets the app drop `sql:default` and
//! `sql:allow-execute` from its capabilities — previously any frontend code
//! could run arbitrary statements.

use std::path::PathBuf;
use tauri::State;

use crate::db::index::HitKind;
use crate::db::{queries, salvage, DbState};
use crate::ipc::{AppError, Classify};

/// A count for the interface. Counts here are rows in one library, far below
/// `u32::MAX`, and saturating is the honest answer if one ever isn't.
fn count(n: u64) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// Open the source library, creating it if this is the first run.
#[tauri::command]
#[specta::specta]
pub async fn open_library(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    path: String,
) -> Result<(), AppError> {
    // A failed backup is said once, as a toast, and never stops the library
    // opening (M1a-5 AC-5). An event rather than a result: the daily backup
    // finishes after this command has returned.
    let report: crate::db::BackupReport = std::sync::Arc::new(move |message: String| {
        log::warn!("Library backup failed: {message}");
        let _ = tauri::Emitter::emit(&app, "library-backup-failed", message);
    });
    state
        .open_library_reporting(&PathBuf::from(path), report)
        .await
        .or_database()
}

/// Open a project folder, creating `<root>/.erti/project.db` if needed.
#[tauri::command]
#[specta::specta]
pub async fn open_project(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    root: String,
) -> Result<(), AppError> {
    // The webview reads and writes the project through the fs plugin (PDFs,
    // manuscripts, the export folder), and its scope starts with nothing of
    // the user's: `fs:allow-home-read-recursive` is gone (M1a-4). Granted
    // before the switch, so a failure leaves the previous project open rather
    // than a new one the webview can't reach. Tauri's scope can't be narrowed
    // again later, so a project opened earlier stays reachable until Erti
    // restarts; the grant also reaches `Grants` through the `PathAllowed`
    // listener in lib.rs, so the Rust path commands keep it for the session too.
    //
    // The path as the user chose it, not where it resolves: Tauri adds the
    // canonical form itself, but matches a file that doesn't exist yet (a new
    // manuscript, the export) by the path the webview sends, which is this one.
    crate::scope::may_open_project(&state, &root).await?;
    tauri_plugin_fs::FsExt::fs_scope(&app)
        .allow_directory(PathBuf::from(&root), true)
        .map_err(|e| AppError::internal(format!("could not grant the project folder: {e}")))?;

    open_project_in(&state, root).await
}

/// Which of these folders are still Erti projects: there, with the
/// `.erti/project.db` opening them left behind.
///
/// The landing screen marks a moved or deleted recent project, and used to ask
/// the fs plugin whether each path existed, which needed read access to all of
/// `$HOME`. This answers only the question it had, and only about project
/// folders: an arbitrary path gets `false`, so it says nothing about the disk.
#[tauri::command]
#[specta::specta]
pub async fn recent_projects_present(paths: Vec<String>) -> Result<Vec<bool>, AppError> {
    let mut present = Vec::with_capacity(paths.len());
    for path in paths.iter().take(100) {
        let known = !crate::scope::refused_form(path)
            && tokio::fs::try_exists(PathBuf::from(path).join(".erti").join("project.db"))
                .await
                .unwrap_or(false);
        present.push(known);
    }
    present.resize(paths.len(), false);
    Ok(present)
}

/// `open_project`, gated (M1a-3): the open project decides what the other path
/// commands accept, so opening `/` must not be possible.
pub async fn open_project_in(state: &DbState, root: String) -> Result<(), AppError> {
    crate::scope::may_open_project(state, &root).await?;
    state.open_project(&PathBuf::from(root)).await.or_database()
}

/// Add a cited source this library lacks, from the manuscript's snapshot, and
/// put it in the open project (M1a-8 AC-6). The webview guards the snapshot as
/// CSL first (M1b-10); this refuses anything that isn't a JSON object or an id
/// that couldn't be a source's.
#[tauri::command]
#[specta::specta]
pub async fn add_source_from_manuscript(
    state: State<'_, DbState>,
    id: String,
    csl_json: String,
) -> Result<bool, AppError> {
    add_source_from_manuscript_in(&state, id, csl_json).await
}

pub async fn add_source_from_manuscript_in(
    state: &DbState,
    id: String,
    csl_json: String,
) -> Result<bool, AppError> {
    let invalid = |message: &str| AppError::new(crate::ipc::ErrorKind::InvalidInput, message);
    if id.is_empty() || id.len() > 200 || id.chars().any(char::is_control) {
        return Err(invalid("That isn't a source id."));
    }
    let csl: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&csl_json)
        .map_err(|_| invalid("That source's details are damaged."))?;
    let text = |key: &str| csl.get(key).and_then(|v| v.as_str()).map(str::to_owned);

    let library = state.library().await?;
    let added = queries::add_source_without_file(
        &library,
        &id,
        &csl_json,
        text("zotero_type").as_deref(),
        text("DOI").as_deref(),
    )
    .await
    .or_database()?;

    if let Ok(project) = state.project().await {
        queries::add_to_project(&project, &id).await.or_database()?;
    }
    Ok(added)
}

/// Add a source the researcher entered by hand (M1b-5, UX-2): a work with no
/// file, in the library and the open project.
///
/// The id is made in the webview, as a mark's is (`crypto.randomUUID`), and
/// checked here: it has to be one no hash can be, so a PDF found later never
/// collides with it (ADR 003).
#[tauri::command]
#[specta::specta]
pub async fn add_source_by_hand(
    state: State<'_, DbState>,
    id: String,
    csl_json: String,
    zotero_type: String,
) -> Result<(), AppError> {
    add_source_by_hand_in(&state, id, csl_json, zotero_type).await
}

pub async fn add_source_by_hand_in(
    state: &DbState,
    id: String,
    csl_json: String,
    zotero_type: String,
) -> Result<(), AppError> {
    add_work_in(state, id, csl_json, zotero_type, false).await
}

/// Add a source whose details were looked up for a DOI (M1b-6, UX-2): as
/// `add_source_by_hand`, but recorded as resolved from the DOI it carries.
#[tauri::command]
#[specta::specta]
pub async fn add_source_from_doi(
    state: State<'_, DbState>,
    id: String,
    csl_json: String,
    zotero_type: String,
) -> Result<(), AppError> {
    add_source_from_doi_in(&state, id, csl_json, zotero_type).await
}

pub async fn add_source_from_doi_in(
    state: &DbState,
    id: String,
    csl_json: String,
    zotero_type: String,
) -> Result<(), AppError> {
    add_work_in(state, id, csl_json, zotero_type, true).await
}

/// The work in the library with this DOI, if there is one (M1b-6 AC-3), so
/// adding it again opens it instead.
#[tauri::command]
#[specta::specta]
pub async fn source_for_doi(
    state: State<'_, DbState>,
    doi: String,
) -> Result<Option<String>, AppError> {
    source_for_doi_in(&state, doi).await
}

pub async fn source_for_doi_in(state: &DbState, doi: String) -> Result<Option<String>, AppError> {
    let library = state.library().await?;
    queries::source_for_doi(&library, &doi).await.or_database()
}

/// The library's works, for an import to be matched against before anything
/// is written (M1b-9 AC-4).
#[tauri::command]
#[specta::specta]
pub async fn library_works(
    state: State<'_, DbState>,
) -> Result<Vec<queries::LibraryWork>, AppError> {
    let library = state.library().await?;
    queries::library_works(&library).await.or_database()
}

/// The most sources one `import_sources` call takes: enough that ten thousand
/// is a few dozen calls, few enough that each is quick to report progress by.
pub const IMPORT_BATCH: usize = 500;

/// One source of a bibliography being imported (M1b-9).
#[derive(Debug, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct ImportedSource {
    /// `erti:<uuid>`, made in the webview as one entered by hand is.
    pub id: String,
    pub csl_json: String,
    pub zotero_type: String,
}

/// What an `import_sources` call did with its sources.
#[derive(Debug, serde::Serialize, serde::Deserialize, specta::Type, PartialEq, Eq)]
pub struct ImportedBatch {
    /// Added to the library, and to the project when asked.
    pub added: Vec<String>,
    /// Left out: the library has a work with the DOI, or the id, already.
    /// The preview leaves these out too; one is here only when the library
    /// gained it between the preview and the import.
    pub skipped: Vec<String>,
}

/// Add a batch of an imported bibliography's sources to the library, and to
/// the open project if `to_project` (M1b-9, docs/ux.md UX-6). Each is a work
/// with no file, checked as one entered by hand is; a batch with one that
/// isn't is refused whole, before anything is written.
#[tauri::command]
#[specta::specta]
pub async fn import_sources(
    state: State<'_, DbState>,
    sources: Vec<ImportedSource>,
    to_project: bool,
) -> Result<ImportedBatch, AppError> {
    import_sources_in(&state, sources, to_project).await
}

pub async fn import_sources_in(
    state: &DbState,
    sources: Vec<ImportedSource>,
    to_project: bool,
) -> Result<ImportedBatch, AppError> {
    if sources.len() > IMPORT_BATCH {
        return Err(AppError::new(
            crate::ipc::ErrorKind::InvalidInput,
            format!("Import at most {IMPORT_BATCH} sources at a time."),
        ));
    }
    let dois = sources
        .iter()
        .map(|s| checked_work(&s.id, &s.csl_json, &s.zotero_type))
        .collect::<Result<Vec<_>, _>>()?;
    let rows: Vec<queries::Imported> = sources
        .iter()
        .zip(&dois)
        .map(|(s, doi)| queries::Imported {
            id: &s.id,
            csl_json: &s.csl_json,
            zotero_type: &s.zotero_type,
            doi: doi.as_deref(),
        })
        .collect();

    let library = state.library().await?;
    let outcomes = queries::import_sources(&library, &rows)
        .await
        .or_database()?;
    let mut batch = ImportedBatch {
        added: Vec::new(),
        skipped: Vec::new(),
    };
    for (source, outcome) in sources.into_iter().zip(outcomes) {
        match outcome {
            queries::Added::Yes => batch.added.push(source.id),
            _ => batch.skipped.push(source.id),
        }
    }
    if to_project {
        // In the library either way: that's what importing is, and adding to
        // the project is what the box asks for as well.
        let project = state.project().await?;
        queries::add_all_to_project(&project, &batch.added)
            .await
            .or_database()?;
    }
    Ok(batch)
}

/// The DOI of a work with no file, as the library stores it, once its id and
/// details are checked: an `erti:<uuid>` id, a title, and a CSL and Zotero
/// type. By hand, from a DOI, or imported (M1b-5, M1b-6, M1b-9).
fn checked_work(id: &str, csl_json: &str, zotero_type: &str) -> Result<Option<String>, AppError> {
    let invalid = |message: &str| AppError::new(crate::ipc::ErrorKind::InvalidInput, message);
    let uuid = id.strip_prefix("erti:").unwrap_or_default();
    let shaped = uuid.len() == 36
        && uuid.char_indices().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        });
    if !shaped {
        return Err(invalid("That isn't an id for a source entered by hand."));
    }
    let csl: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(csl_json).map_err(|_| invalid("Those details aren't a source."))?;
    let titled = csl
        .get("title")
        .and_then(|v| v.as_str())
        .is_some_and(|t| !t.trim().is_empty());
    if !titled {
        return Err(invalid("Give the source a title."));
    }
    // A CSL type too: citeproc formats by it, and without one the source is
    // stored ready to cite but can't be.
    let typed = csl
        .get("type")
        .and_then(|v| v.as_str())
        .is_some_and(|t| !t.is_empty());
    if !typed || zotero_type.is_empty() || zotero_type.len() > 64 {
        return Err(invalid("Choose what kind of source it is."));
    }
    // Stored as the library compares it, so a DOI typed as a link is found by
    // the bare one, and finds it.
    let doi = csl
        .get("DOI")
        .and_then(|v| v.as_str())
        .and_then(queries::normalise_doi);
    Ok(doi)
}

/// A work with no file, by hand or from a DOI. The DOI is read from the
/// details either way, so that a DOI typed into the form is found later too,
/// and a work the library has under it already is refused: the second copy
/// would split the citations between them.
async fn add_work_in(
    state: &DbState,
    id: String,
    csl_json: String,
    zotero_type: String,
    from_doi: bool,
) -> Result<(), AppError> {
    let doi = checked_work(&id, &csl_json, &zotero_type)?;
    let doi = doi.as_deref();
    if from_doi && doi.is_none() {
        return Err(AppError::new(
            crate::ipc::ErrorKind::InvalidInput,
            "Those details have no DOI.",
        ));
    }

    let library = state.library().await?;
    // The DOI is checked in the same transaction as the insert (queries.rs),
    // so two adds of one DOI at once can't both find it free.
    let added = match (from_doi, doi) {
        (true, Some(doi)) => {
            queries::add_source_from_doi(&library, &id, &csl_json, &zotero_type, doi).await
        }
        _ => queries::add_source_by_hand(&library, &id, &csl_json, &zotero_type, doi).await,
    }
    .or_database()?;
    match added {
        queries::Added::Yes => {}
        queries::Added::IdTaken => {
            return Err(AppError::new(
                crate::ipc::ErrorKind::Conflict,
                "A source with that id is already in the library.",
            ))
        }
        queries::Added::DoiTaken => {
            return Err(AppError::new(
                crate::ipc::ErrorKind::Conflict,
                "A source with that DOI is already in the library.",
            ))
        }
    }
    if let Ok(project) = state.project().await {
        // Two databases, so no one transaction: a source the project failed to
        // take is taken back out of the library, or "Add" again would leave a
        // copy in no project for each try.
        if let Err(e) = queries::add_to_project(&project, &id).await {
            let _ = queries::remove_source(&library, &id).await;
            return Err(AppError::database(e));
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn project_root(state: State<'_, DbState>) -> Result<String, AppError> {
    Ok(state.project_root().await?.to_string_lossy().to_string())
}

/// Hash a file's contents. See `db::hash_file`.
#[tauri::command]
#[specta::specta]
pub async fn hash_file(state: State<'_, DbState>, path: String) -> Result<String, AppError> {
    hash_file_in(&state, path).await
}

/// `hash_file`, scoped (M1a-3).
pub async fn hash_file_in(state: &DbState, path: String) -> Result<String, AppError> {
    crate::scope::authorise(state, &path).await?;
    // Already classified by what the filesystem said: NotFound, PermissionDenied.
    crate::db::hash_file(&PathBuf::from(path)).await
}

/// Record a source and add it to the open project.
///
/// Returns true when this hash was new to the library, so the caller knows
/// whether the file still needs extracting and embedding, or was already done
/// for another project.
#[tauri::command]
#[specta::specta]
pub async fn register_source(
    state: State<'_, DbState>,
    sha256: String,
    path: String,
    file_name: String,
) -> Result<bool, AppError> {
    register_source_in(&state, sha256, path, file_name).await
}

/// `register_source`, scoped (M1a-3).
pub async fn register_source_in(
    state: &DbState,
    sha256: String,
    path: String,
    file_name: String,
) -> Result<bool, AppError> {
    // The path becomes a recorded location, which `scope::authorise` then
    // accepts. Unchecked, that would let any path in by registering it first.
    crate::scope::authorise(state, &path).await?;
    let library = state.library().await?;
    let is_new = queries::register_source(&library, &sha256, &path, &file_name)
        .await
        .or_database()?;

    // Adding to the project is cheap and never re-embeds: the chunks already
    // exist in the library if another project ingested this file first.
    if let Ok(project) = state.project().await {
        queries::add_to_project(&project, &sha256)
            .await
            .or_database()?;
    }

    Ok(is_new)
}

#[tauri::command]
#[specta::specta]
pub async fn sources_needing_ingest(state: State<'_, DbState>) -> Result<Vec<String>, AppError> {
    queries::sources_needing_ingest(&state.library().await?)
        .await
        .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn store_chunks(
    state: State<'_, DbState>,
    sha256: String,
    chunks: Vec<queries::NewChunk>,
) -> Result<(), AppError> {
    store_chunks_in(&state, &sha256, &chunks).await
}

pub async fn store_chunks_in(
    state: &DbState,
    sha256: &str,
    chunks: &[queries::NewChunk],
) -> Result<(), AppError> {
    let stored = queries::store_chunks(&state.library().await?, sha256, chunks).await;
    // Whatever happened: a failed write may still have changed something.
    state.invalidate_index();
    stored.or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn mark_ingest_failed(
    state: State<'_, DbState>,
    sha256: String,
    error: String,
) -> Result<(), AppError> {
    queries::mark_ingest_failed(&state.library().await?, &sha256, &error)
        .await
        .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn set_source_metadata(
    state: State<'_, DbState>,
    sha256: String,
    csl_json: String,
    zotero_type: Option<String>,
    doi: Option<String>,
    resolved_via: String,
) -> Result<(), AppError> {
    queries::set_source_metadata(
        &state.library().await?,
        &sha256,
        &csl_json,
        zotero_type.as_deref(),
        doi.as_deref(),
        &resolved_via,
    )
    .await
    .or_database()
}

/// Sources in the open project, with project-local metadata overrides applied.
#[tauri::command]
#[specta::specta]
pub async fn project_sources(state: State<'_, DbState>) -> Result<Vec<queries::Source>, AppError> {
    queries::project_sources(&state.library().await?, &state.project().await?)
        .await
        .or_database()
}

/// Every alias in the library, alias → canonical (ADR 003).
///
/// The webview resolves the ids a manuscript cites with this, so a citation
/// of a PDF's hash renders as the work the PDF was attached to.
#[tauri::command]
#[specta::specta]
pub async fn source_aliases(
    state: State<'_, DbState>,
) -> Result<std::collections::HashMap<String, String>, AppError> {
    source_aliases_in(&state).await
}

/// `source_aliases`, reachable from tests.
pub async fn source_aliases_in(
    state: &DbState,
) -> Result<std::collections::HashMap<String, String>, AppError> {
    queries::alias_map(&state.library().await?)
        .await
        .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn add_to_project(state: State<'_, DbState>, sha256: String) -> Result<(), AppError> {
    queries::add_to_project(&state.project().await?, &sha256)
        .await
        .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn set_metadata_override(
    state: State<'_, DbState>,
    sha256: String,
    csl_json: String,
) -> Result<(), AppError> {
    queries::set_metadata_override(&state.project().await?, &sha256, &csl_json)
        .await
        .or_database()
}

/// What removing a source would delete, for the dialog that asks first.
#[tauri::command]
#[specta::specta]
pub async fn source_removal(
    state: State<'_, DbState>,
    id: String,
) -> Result<queries::SourceRemoval, AppError> {
    queries::source_removal(&state.library().await?, &id)
        .await
        .or_database()
}

/// Remove a source from the library, with its files' records, marks and
/// notes (M1b-4). The PDFs stay where they are.
#[tauri::command]
#[specta::specta]
pub async fn remove_source(state: State<'_, DbState>, id: String) -> Result<(), AppError> {
    remove_source_in(&state, &id).await
}

pub async fn remove_source_in(state: &DbState, id: &str) -> Result<(), AppError> {
    // The toast says it can be restored from a backup, and the marks made
    // since this morning's would otherwise be in none. No copy, no removal.
    state.back_up_library().await.map_err(|e| {
        AppError::new(
            e.kind,
            format!(
                "Could not back up the library first, so nothing was removed: {}",
                e.message
            ),
        )
    })?;
    let removed = queries::remove_source(&state.library().await?, id).await;
    // Its passages, marks and notes had vectors, and the cascade took them.
    state.invalidate_index();
    removed.or_database()
}

/// A file attached to a work, and what's left to do with it (M1b-7).
#[derive(Debug, serde::Serialize, serde::Deserialize, specta::Type, PartialEq, Eq)]
pub struct AttachedFile {
    /// The file's own hash, which reading it goes under.
    pub sha256: String,
    pub file_name: String,
    /// False when the library has read it already, for another project.
    pub needs_ingest: bool,
    /// The source this file was until now, by title or file name, when the
    /// library had it as one of its own: its citations now render as the work
    /// it joined, and its row in any project is that work's.
    pub merged: Option<String>,
    /// It was already this source's file, found somewhere new: the place is
    /// recorded, and Open and Show in folder use it.
    pub found_again: bool,
}

/// Attach the PDF at `path` to the work `work` (M1b-7, ADR 003).
#[tauri::command]
#[specta::specta]
pub async fn attach_file(
    state: State<'_, DbState>,
    work: String,
    path: String,
) -> Result<AttachedFile, AppError> {
    attach_file_in(&state, &work, path).await
}

/// `attach_file`, scoped (M1a-3): the path is one the user picked, and is
/// recorded as a location, which `scope::authorise` then accepts.
pub async fn attach_file_in(
    state: &DbState,
    work: &str,
    path: String,
) -> Result<AttachedFile, AppError> {
    use crate::ipc::ErrorKind;

    crate::scope::authorise(state, &path).await?;
    let sha256 = crate::db::hash_file(&PathBuf::from(&path)).await?;
    // A PDF, and only a PDF: its place is recorded, and a recorded place is
    // one `scope::authorise` accepts in later sessions too. Anything else
    // would turn a grant meant for this session into a lasting one. After
    // hashing, so a file that's gone is said as such.
    if !is_pdf(&path).await {
        return Err(AppError::new(
            ErrorKind::InvalidInput,
            "That file isn't a PDF.",
        ));
    }
    let file_name = PathBuf::from(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    let attached = queries::attach_file(&state.library().await?, work, &sha256, &path, &file_name)
        .await
        .or_database()?;
    match attached {
        queries::Attach::Attached {
            needs_ingest,
            merged,
        } => Ok(AttachedFile {
            sha256,
            file_name,
            needs_ingest,
            merged,
            found_again: false,
        }),
        queries::Attach::FoundAgain { needs_ingest } => Ok(AttachedFile {
            sha256,
            file_name,
            needs_ingest,
            merged: None,
            found_again: true,
        }),
        queries::Attach::HasFiles(title) => {
            Err(AppError::new(
                ErrorKind::Conflict,
                format!(
                "That PDF is {}, which has files of its own, so it can't be another source's file.",
                title.map_or_else(|| "a source".to_string(), |t| format!("\u{201c}{t}\u{201d}"))
            ),
            ))
        }
        queries::Attach::AlreadyIts => Err(AppError::new(
            ErrorKind::Conflict,
            "That PDF is already attached to this source.",
        )),
        queries::Attach::Elsewhere(title) => Err(AppError::new(
            ErrorKind::Conflict,
            match title {
                Some(title) => format!("That PDF is already attached to \u{201c}{title}\u{201d}."),
                None => "That PDF is already attached to another source.".to_string(),
            },
        )),
        queries::Attach::NoWork => Err(AppError::new(
            ErrorKind::NotFound,
            "That source is no longer in the library.",
        )),
    }
}

/// Whether the file at `path` starts as a PDF does. Read, not trusted from
/// the name: the picker filters by extension, but the command can be called
/// with any path.
async fn is_pdf(path: &str) -> bool {
    use tokio::io::AsyncReadExt;
    let mut head = [0u8; 4];
    match tokio::fs::File::open(path).await {
        Ok(mut file) => file.read_exact(&mut head).await.is_ok() && &head == b"%PDF",
        Err(_) => false,
    }
}

/// The most paths `pdfs_found` looks for at once.
pub const FIND_BATCH: usize = 1000;

/// Which of `paths` are PDFs Erti may attach (M1b-9 AC-4): ones the import
/// preview lists as to attach, and the rest as not found.
///
/// Scoped as `attach_file` is, so the answer is the same one attaching would
/// get. Outside the scope a file is "not found" whether it's there or not: the
/// webview learns nothing about a folder the user hasn't shown it.
#[tauri::command]
#[specta::specta]
pub async fn pdfs_found(
    state: State<'_, DbState>,
    paths: Vec<String>,
) -> Result<Vec<bool>, AppError> {
    pdfs_found_in(&state, paths).await
}

/// `pdfs_found`, reachable from tests.
pub async fn pdfs_found_in(state: &DbState, paths: Vec<String>) -> Result<Vec<bool>, AppError> {
    if paths.len() > FIND_BATCH {
        return Err(AppError::new(
            crate::ipc::ErrorKind::InvalidInput,
            format!("Look for at most {FIND_BATCH} files at a time."),
        ));
    }
    let mut found = Vec::with_capacity(paths.len());
    for path in paths {
        found.push(match crate::scope::authorise(state, &path).await {
            Ok(canonical) => is_pdf(&canonical.to_string_lossy()).await,
            Err(_) => false,
        });
    }
    Ok(found)
}

/// A work's files, for its sidebar's File tab (M1b-7 AC-3).
#[tauri::command]
#[specta::specta]
pub async fn source_files(
    state: State<'_, DbState>,
    id: String,
) -> Result<Vec<queries::SourceFile>, AppError> {
    source_files_in(&state, &id).await
}

/// `source_files`, reachable from tests.
///
/// Each file is shown where it can still be found, newest first, so a PDF
/// moved within the project folder and seen again by a scan isn't reported
/// missing for the place it left.
pub async fn source_files_in(
    state: &DbState,
    id: &str,
) -> Result<Vec<queries::SourceFile>, AppError> {
    let files = queries::source_file_locations(&state.library().await?, id)
        .await
        .or_database()?;
    let mut out = Vec::with_capacity(files.len());
    for (mut file, seen) in files {
        for (path, file_name) in seen {
            if tokio::fs::try_exists(&path).await.unwrap_or(false) {
                file.path = path;
                file.file_name = file_name;
                file.found = true;
                break;
            }
        }
        out.push(file);
    }
    Ok(out)
}

/// Rank chunks against a piece of text the user is writing.
///
/// Embedding and scoring both happen here; only the top results cross the IPC
/// boundary, rather than the entire corpus as before.
#[tauri::command]
#[specta::specta]
pub async fn search_sources(
    state: State<'_, DbState>,
    query: String,
    limit: Option<u32>,
    include_library: Option<bool>,
) -> Result<Vec<queries::ScoredChunk>, AppError> {
    let embedding = embed_query(query).await?;

    let project_hashes = open_project_sources(&state).await?;
    let (library, index) = state.index().await?;

    queries::search_chunks(
        &index,
        &library,
        &embedding,
        &project_hashes,
        limit.unwrap_or(5) as usize,
        include_library.unwrap_or(false),
    )
    .await
    .or_database()
}

/// The open project's sources, or none when no project is open.
async fn open_project_sources(state: &DbState) -> Result<Vec<String>, AppError> {
    match state.project().await {
        Ok(project) => queries::project_source_hashes(&project).await.or_database(),
        Err(_) => Ok(Vec::new()),
    }
}

/// Embed a piece of text for a search. Inference is synchronous ONNX with no
/// await points, so it runs on the blocking pool, not an async worker.
async fn embed_query(query: String) -> Result<Vec<f32>, AppError> {
    tokio::task::spawn_blocking(move || crate::commands::embed_texts(&[query], true))
        .await
        .or_internal()?
        .or_model()?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::model("the query produced no embedding"))
}

/// Search everything in the library by meaning: passages, marks and source
/// notes, in one ranked list, each result saying which it is (ADR 005).
///
/// `kinds` narrows it (all three when left out), and only the open project's
/// works count unless `include_library`. Both apply before scoring, so a
/// narrower search still fills `limit`. The project's results come first.
#[tauri::command]
#[specta::specta]
pub async fn search_library(
    state: State<'_, DbState>,
    query: String,
    kinds: Option<Vec<HitKind>>,
    limit: Option<u32>,
    include_library: Option<bool>,
) -> Result<Vec<queries::Hit>, AppError> {
    let embedding = embed_query(query).await?;
    search_library_in(&state, &embedding, kinds, limit, include_library).await
}

/// `search_library` from a vector already made, so tests can reach it without
/// the model.
pub async fn search_library_in(
    state: &DbState,
    embedding: &[f32],
    kinds: Option<Vec<HitKind>>,
    limit: Option<u32>,
    include_library: Option<bool>,
) -> Result<Vec<queries::Hit>, AppError> {
    let project_hashes = open_project_sources(state).await?;
    let (library, index) = state.index().await?;

    queries::search_index(
        &index,
        &library,
        embedding,
        &project_hashes,
        &kinds.unwrap_or_default(),
        limit.unwrap_or(20) as usize,
        include_library.unwrap_or(false),
    )
    .await
    .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn embedding_meta(
    state: State<'_, DbState>,
) -> Result<Option<queries::EmbeddingMeta>, AppError> {
    Ok(queries::embedding_meta(&state.library().await?)
        .await
        .or_database()?
        .map(|(model_id, dims)| queries::EmbeddingMeta { model_id, dims }))
}

#[tauri::command]
#[specta::specta]
pub async fn set_embedding_meta(
    state: State<'_, DbState>,
    model_id: String,
    dims: u32,
) -> Result<(), AppError> {
    let set = queries::set_embedding_meta(&state.library().await?, &model_id, dims.into()).await;
    // Vectors from another model are in another space (ADR 005).
    state.invalidate_index();
    set.or_database()
}

/// Import metadata from the pre-hybrid database, if one exists.
///
/// The old database is only read, never modified — it stays on disk so nothing
/// is lost if the result is unsatisfactory.
#[tauri::command]
#[specta::specta]
pub async fn import_legacy_metadata(
    state: State<'_, DbState>,
    legacy_db_path: String,
) -> Result<salvage::SalvageReport, AppError> {
    salvage::import_legacy_metadata(&state.library().await?, &PathBuf::from(legacy_db_path))
        .await
        .or_database()
}

/// Metadata previously resolved for this filename, if any.
#[tauri::command]
#[specta::specta]
pub async fn legacy_metadata_for(
    state: State<'_, DbState>,
    file_name: String,
) -> Result<Option<String>, AppError> {
    salvage::legacy_metadata_for(&state.library().await?, &file_name)
        .await
        .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn mark_legacy_consumed(
    state: State<'_, DbState>,
    file_name: String,
) -> Result<(), AppError> {
    salvage::mark_legacy_consumed(&state.library().await?, &file_name)
        .await
        .or_database()
}

/* ------------------------------------------------------------- annotations */

#[tauri::command]
#[specta::specta]
pub async fn save_annotation(
    state: State<'_, DbState>,
    annotation: queries::NewAnnotation,
) -> Result<(), AppError> {
    queries::save_annotation(&state.library().await?, &annotation)
        .await
        .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn annotations_for_source(
    state: State<'_, DbState>,
    sha256: String,
) -> Result<Vec<queries::Annotation>, AppError> {
    queries::annotations_for_source(&state.library().await?, &sha256)
        .await
        .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn all_annotations(
    state: State<'_, DbState>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<queries::Annotation>, AppError> {
    queries::all_annotations(
        &state.library().await?,
        limit.unwrap_or(200).into(),
        offset.unwrap_or(0).into(),
    )
    .await
    .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn delete_annotation(state: State<'_, DbState>, id: String) -> Result<(), AppError> {
    let deleted = queries::delete_annotation(&state.library().await?, &id).await;
    state.invalidate_index();
    deleted.or_database()
}

/* ------------------------------------------------------------ source notes */

/// A work's notes and the marks on its files, for its Notes tab (M1b-8, UX-3).
#[tauri::command]
#[specta::specta]
pub async fn work_notes(
    state: State<'_, DbState>,
    id: String,
) -> Result<queries::WorkNotes, AppError> {
    work_notes_in(&state, id).await
}

pub async fn work_notes_in(state: &DbState, id: String) -> Result<queries::WorkNotes, AppError> {
    queries::work_notes(&state.library().await?, &id)
        .await
        .or_database()
}

/// Write a note on a work, or rewrite one (M1b-8 AC-2, ADR 004).
#[tauri::command]
#[specta::specta]
pub async fn save_source_note(
    state: State<'_, DbState>,
    note: queries::NewSourceNote,
) -> Result<(), AppError> {
    save_source_note_in(&state, note).await
}

pub async fn save_source_note_in(
    state: &DbState,
    note: queries::NewSourceNote,
) -> Result<(), AppError> {
    let invalid = |message: &str| AppError::new(crate::ipc::ErrorKind::InvalidInput, message);
    // Blank optional fields are absent, not empty: a page of "" would offer
    // to cite p. nothing.
    let given = |value: Option<String>| {
        value
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    };
    let note = queries::NewSourceNote {
        // Only the end: Markdown's leading spaces are meaning (an indented
        // code block, a nested item), and are kept as written.
        body: note.body.trim_end().to_string(),
        quote: given(note.quote),
        page_label: given(note.page_label),
        label_id: given(note.label_id),
        ..note
    };
    if note.id.is_empty() || note.id.len() > 200 {
        return Err(invalid("That isn't a note id."));
    }
    if note.body.trim().is_empty() && note.quote.is_none() {
        return Err(invalid("Write a note, or the words you're quoting."));
    }
    // The same ceilings the guard puts on a long field and a short one (M1b-10).
    if note.body.chars().count() > 200_000
        || note
            .quote
            .as_ref()
            .is_some_and(|q| q.chars().count() > 200_000)
    {
        return Err(invalid("That note is too long to keep."));
    }
    if note
        .page_label
        .as_ref()
        .is_some_and(|p| p.chars().count() > 100)
    {
        return Err(invalid(
            "A page is a number or a short label, such as 853 or xiv.",
        ));
    }

    let library = state.library().await?;
    let saved = queries::save_source_note(&library, &note).await;
    // The note's words may have changed, and the index holds what they were.
    state.invalidate_index();
    if !saved.or_database()? {
        return Err(AppError::new(
            crate::ipc::ErrorKind::NotFound,
            "That source isn't in the library any more.",
        ));
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_source_note(state: State<'_, DbState>, id: String) -> Result<(), AppError> {
    delete_source_note_in(&state, id).await
}

pub async fn delete_source_note_in(state: &DbState, id: String) -> Result<(), AppError> {
    let deleted = queries::delete_source_note(&state.library().await?, &id).await;
    state.invalidate_index();
    deleted.or_database()
}

/// Embed a source note's words so a search by meaning finds it (M1b-8 AC-4).
///
/// Asked for after the note is saved, as a mark's is, rather than inside the
/// save: inference can take a moment while the model loads, and a note must
/// never wait on it, or be lost to it failing. The words are read back from
/// the library, so what's embedded is what was kept. Skipped, resolving false,
/// when they haven't changed since they were last embedded: relabelling a note
/// costs no inference. False too when the note was saved again while this one
/// was embedding: that save's own embedding has the words that stand.
#[tauri::command]
#[specta::specta]
pub async fn embed_source_note(state: State<'_, DbState>, id: String) -> Result<bool, AppError> {
    embed_source_note_with(&state, &id, |text| {
        crate::commands::embed_texts(&[text], true)?
            .into_iter()
            .next()
            .ok_or_else(|| "the note produced no embedding".to_string())
    })
    .await
}

/// `embed_source_note` with the model passed in, so tests can count what it's
/// asked to embed.
pub async fn embed_source_note_with(
    state: &DbState,
    id: &str,
    embed: impl FnOnce(String) -> Result<Vec<f32>, String> + Send + 'static,
) -> Result<bool, AppError> {
    let library = state.library().await?;
    let Some(note) = queries::source_note_to_embed(&library, id)
        .await
        .or_database()?
    else {
        return Ok(false);
    };
    // spawn_blocking for the same reason search_sources does it: inference has
    // no await points and would hold an async worker for its whole duration.
    let text = note.text.clone();
    let embedding = tokio::task::spawn_blocking(move || embed(text))
        .await
        .or_internal()?
        .or_model()?;

    let saved = queries::save_source_note_embedding(&library, &note, &embedding).await;
    state.invalidate_index();
    saved.or_database()
}

/// Every source note in the library, for the notes export (M1b-8 AC-5).
#[tauri::command]
#[specta::specta]
pub async fn all_source_notes(
    state: State<'_, DbState>,
) -> Result<Vec<queries::NamedSourceNote>, AppError> {
    queries::all_source_notes(&state.library().await?)
        .await
        .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn delete_imported_annotations(
    state: State<'_, DbState>,
    sha256: String,
) -> Result<u32, AppError> {
    let deleted = queries::delete_imported_annotations(&state.library().await?, &sha256).await;
    state.invalidate_index();
    deleted.or_database().map(count)
}

#[tauri::command]
#[specta::specta]
pub async fn annotation_labels(
    state: State<'_, DbState>,
) -> Result<Vec<queries::AnnotationLabel>, AppError> {
    queries::annotation_labels(&state.library().await?)
        .await
        .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn save_label(
    state: State<'_, DbState>,
    label: queries::AnnotationLabel,
) -> Result<(), AppError> {
    queries::save_label(&state.library().await?, &label)
        .await
        .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn delete_label(state: State<'_, DbState>, id: String) -> Result<(), AppError> {
    queries::delete_label(&state.library().await?, &id)
        .await
        .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn save_reading_position(
    state: State<'_, DbState>,
    sha256: String,
    page: u32,
    scroll: Option<f64>,
    scale: Option<String>,
) -> Result<(), AppError> {
    queries::save_reading_position(
        &state.library().await?,
        &sha256,
        page.into(),
        scroll,
        scale.as_deref(),
    )
    .await
    .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn reading_position(
    state: State<'_, DbState>,
    sha256: String,
) -> Result<Option<u32>, AppError> {
    Ok(queries::reading_position(&state.library().await?, &sha256)
        .await
        .or_database()?
        .and_then(|page| u32::try_from(page).ok()))
}

#[tauri::command]
#[specta::specta]
pub async fn path_for_source(
    state: State<'_, DbState>,
    sha256: String,
) -> Result<Option<String>, AppError> {
    queries::path_for_source(&state.library().await?, &sha256)
        .await
        .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn source_for_path(
    state: State<'_, DbState>,
    path: String,
) -> Result<Option<String>, AppError> {
    source_for_path_in(&state, path).await
}

/// `source_for_path`, scoped (M1a-3).
pub async fn source_for_path_in(state: &DbState, path: String) -> Result<Option<String>, AppError> {
    crate::scope::authorise(state, &path).await?;
    queries::source_for_path(&state.library().await?, &path)
        .await
        .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn save_annotation_image(
    state: State<'_, DbState>,
    id: String,
    png: Vec<u8>,
) -> Result<(), AppError> {
    queries::save_annotation_image(&state.library().await?, &id, &png)
        .await
        .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn annotation_image(
    state: State<'_, DbState>,
    id: String,
) -> Result<Option<Vec<u8>>, AppError> {
    queries::annotation_image(&state.library().await?, &id)
        .await
        .or_database()
}

/// Embed a mark's text so it can be found by meaning later.
///
/// The embedding happens here rather than in the frontend for the same reason
/// search does: `embed_texts` is synchronous ONNX inference, and a 384-float
/// vector has no business crossing the IPC boundary in either direction when
/// only the database needs it.
///
/// Skipped when the text has not changed. Recolouring a highlight or moving it
/// to another label should not cost an inference.
#[tauri::command]
#[specta::specta]
pub async fn embed_annotation(
    state: State<'_, DbState>,
    id: String,
    text: String,
) -> Result<bool, AppError> {
    let library = state.library().await?;

    let hash = queries::text_hash(&text);

    if queries::annotation_embedding_hash(&library, &id)
        .await
        .or_database()?
        == Some(hash.clone())
    {
        return Ok(false);
    }

    if text.trim().is_empty() {
        return Ok(false);
    }

    // spawn_blocking for the same reason search_sources does it: inference has no
    // await points and would hold an async worker for its whole duration.
    let embedding =
        tokio::task::spawn_blocking(move || crate::commands::embed_texts(&[text], true))
            .await
            .or_internal()?
            .or_model()?
            .into_iter()
            .next()
            .ok_or_else(|| AppError::model("the mark produced no embedding"))?;

    let saved = queries::save_annotation_embedding(&library, &id, &embedding, &hash).await;
    state.invalidate_index();
    saved.or_database()?;

    Ok(true)
}

/// Give every mark that has none a vector, so it can be found by meaning.
///
/// Marks are embedded as they are made, and that can fail quietly — a library
/// not open yet, a model still loading, a save racing a project switch. A
/// highlight must never be lost to a failed embedding, so the failure is
/// swallowed; the cost is that the mark is then missing from every search by
/// meaning with nothing to say so. This is the way back.
///
/// Returns how many were embedded, so the caller can say what happened rather
/// than leave another silence.
#[tauri::command]
#[specta::specta]
pub async fn embed_pending_annotations(state: State<'_, DbState>) -> Result<u32, AppError> {
    let library = state.library().await?;

    // Bounded: a first run over a large library should take a moment and finish,
    // not hold the model for a minute. Running it again picks up the rest.
    let marks = embed_pending_marks(state.inner(), &library).await?;
    // Source notes too (M1b-8 AC-4): "Prepare my notes" means all of them.
    // After the marks, which are kept by now, so a note that fails to embed
    // can't cost a mark its vector.
    let notes = embed_pending_source_notes(state.inner(), &library).await?;
    Ok(count(marks + notes))
}

/// Embed the marks that have no vector, in one batch.
async fn embed_pending_marks(state: &DbState, library: &sqlx::SqlitePool) -> Result<u64, AppError> {
    let pending = queries::annotations_needing_embedding(library, 500)
        .await
        .or_database()?;
    if pending.is_empty() {
        return Ok(0);
    }

    let (ids, texts): (Vec<String>, Vec<String>) = pending.into_iter().unzip();

    // One batch rather than one inference per mark: the model is loaded once and
    // the tokeniser pads the whole set together.
    let embeddings =
        tokio::task::spawn_blocking(move || crate::commands::embed_texts(&texts, true))
            .await
            .or_internal()?
            .or_model()?;

    let mut done = 0;
    for (id, embedding) in ids.iter().zip(embeddings.iter()) {
        // A hash of nothing: these are backfills, and the next real edit
        // re-embeds them under the hash of whatever it then says.
        let saved = queries::save_annotation_embedding(library, id, embedding, "backfilled").await;
        state.invalidate_index();
        saved.or_database()?;
        done += 1;
    }
    Ok(done)
}

/// Embed the source notes whose vector is missing or stale, in one batch,
/// under the hash of their words.
async fn embed_pending_source_notes(
    state: &DbState,
    library: &sqlx::SqlitePool,
) -> Result<u64, AppError> {
    let pending = queries::source_notes_needing_embedding(library, 500)
        .await
        .or_database()?;
    if pending.is_empty() {
        return Ok(0);
    }
    let texts: Vec<String> = pending.iter().map(|note| note.text.clone()).collect();
    let embeddings =
        tokio::task::spawn_blocking(move || crate::commands::embed_texts(&texts, true))
            .await
            .or_internal()?
            .or_model()?;

    let mut done = 0;
    for (note, embedding) in pending.iter().zip(embeddings.iter()) {
        // Not counted when the note changed while the batch ran: its own
        // save's embedding has the words that stand.
        let saved = queries::save_source_note_embedding(library, note, embedding).await;
        state.invalidate_index();
        if saved.or_database()? {
            done += 1;
        }
    }
    Ok(done)
}

/// Find notes, marks and source notes alike, by their words or by what they
/// are about (M1b-8 AC-4, ADR 004).
///
/// Deliberately separate from `search_sources`. A passage from a paper and a
/// note the researcher wrote are not the same kind of thing — one is quotable,
/// the other is a judgement already made — and a 12-word note does not produce
/// a cosine score comparable with a 100-word passage, so merging the two into
/// one ranked list would be quietly wrong in a way nobody could see. A mark and
/// a source note are the same kind of thing, so they share one list, each
/// result saying which it is.
#[tauri::command]
#[specta::specta]
pub async fn search_notes(
    state: State<'_, DbState>,
    query: String,
    limit: Option<u32>,
    semantic: Option<bool>,
) -> Result<Vec<queries::Hit>, AppError> {
    let limit = limit.unwrap_or(50);
    if !semantic.unwrap_or(false) {
        return search_notes_literally_in(&state, query, limit).await;
    }
    let embedding = embed_query(query).await?;
    search_notes_in(&state, &embedding, limit).await
}

/// `search_notes` by words.
pub async fn search_notes_literally_in(
    state: &DbState,
    query: String,
    limit: u32,
) -> Result<Vec<queries::Hit>, AppError> {
    let library = state.library().await?;
    let project_hashes = open_project_sources(state).await?;
    queries::search_notes_literally(&library, &query, &project_hashes, i64::from(limit))
        .await
        .or_database()
}

/// `search_notes` by meaning, from a vector already made, so tests can reach it
/// without the model.
pub async fn search_notes_in(
    state: &DbState,
    embedding: &[f32],
    limit: u32,
) -> Result<Vec<queries::Hit>, AppError> {
    let project_hashes = open_project_sources(state).await?;
    let (library, index) = state.index().await?;
    queries::search_notes_in(&index, &library, embedding, &project_hashes, limit as usize)
        .await
        .or_database()
}

#[tauri::command]
#[specta::specta]
pub async fn restore_default_labels(state: State<'_, DbState>) -> Result<u32, AppError> {
    queries::restore_default_labels(&state.library().await?)
        .await
        .or_database()
        .map(count)
}

#[tauri::command]
#[specta::specta]
pub async fn name_labels_after_colours(state: State<'_, DbState>) -> Result<u32, AppError> {
    queries::name_labels_after_colours(&state.library().await?)
        .await
        .or_database()
        .map(count)
}
