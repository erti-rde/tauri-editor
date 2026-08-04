//! Tauri commands for database access.
//!
//! These are the entire database surface available to the frontend. Nothing here
//! accepts SQL, which is what lets the app drop `sql:default` and
//! `sql:allow-execute` from its capabilities — previously any frontend code
//! could run arbitrary statements.

use std::path::PathBuf;
use tauri::State;

use crate::db::{queries, salvage, DbState};

/// Open the source library, creating it if this is the first run.
#[tauri::command]
pub async fn open_library(state: State<'_, DbState>, path: String) -> Result<(), String> {
    state.open_library(&PathBuf::from(path)).await
}

/// Open a project folder, creating `<root>/.erti/project.db` if needed.
#[tauri::command]
pub async fn open_project(state: State<'_, DbState>, root: String) -> Result<(), String> {
    state.open_project(&PathBuf::from(root)).await
}

#[tauri::command]
pub async fn project_root(state: State<'_, DbState>) -> Result<String, String> {
    Ok(state.project_root().await?.to_string_lossy().to_string())
}

/// Hash a file's contents. See `db::hash_file`.
#[tauri::command]
pub async fn hash_file(path: String) -> Result<String, String> {
    crate::db::hash_file(&PathBuf::from(path)).await
}

/// Record a source and add it to the open project.
///
/// Returns true when this hash was new to the library, so the caller knows
/// whether the file still needs extracting and embedding, or was already done
/// for another project.
#[tauri::command]
pub async fn register_source(
    state: State<'_, DbState>,
    sha256: String,
    path: String,
    file_name: String,
) -> Result<bool, String> {
    let library = state.library().await?;
    let is_new = queries::register_source(&library, &sha256, &path, &file_name).await?;

    // Adding to the project is cheap and never re-embeds: the chunks already
    // exist in the library if another project ingested this file first.
    if let Ok(project) = state.project().await {
        queries::add_to_project(&project, &sha256).await?;
    }

    Ok(is_new)
}

#[tauri::command]
pub async fn sources_needing_ingest(state: State<'_, DbState>) -> Result<Vec<String>, String> {
    queries::sources_needing_ingest(&state.library().await?).await
}

#[tauri::command]
pub async fn store_chunks(
    state: State<'_, DbState>,
    sha256: String,
    chunks: Vec<queries::NewChunk>,
) -> Result<(), String> {
    queries::store_chunks(&state.library().await?, &sha256, &chunks).await
}

#[tauri::command]
pub async fn mark_ingest_failed(
    state: State<'_, DbState>,
    sha256: String,
    error: String,
) -> Result<(), String> {
    queries::mark_ingest_failed(&state.library().await?, &sha256, &error).await
}

#[tauri::command]
pub async fn set_source_metadata(
    state: State<'_, DbState>,
    sha256: String,
    csl_json: String,
    zotero_type: Option<String>,
    doi: Option<String>,
    resolved_via: String,
) -> Result<(), String> {
    queries::set_source_metadata(
        &state.library().await?,
        &sha256,
        &csl_json,
        zotero_type.as_deref(),
        doi.as_deref(),
        &resolved_via,
    )
    .await
}

/// Sources in the open project, with project-local metadata overrides applied.
#[tauri::command]
pub async fn project_sources(state: State<'_, DbState>) -> Result<Vec<queries::Source>, String> {
    queries::project_sources(&state.library().await?, &state.project().await?).await
}

#[tauri::command]
pub async fn add_to_project(state: State<'_, DbState>, sha256: String) -> Result<(), String> {
    queries::add_to_project(&state.project().await?, &sha256).await
}

#[tauri::command]
pub async fn set_metadata_override(
    state: State<'_, DbState>,
    sha256: String,
    csl_json: String,
) -> Result<(), String> {
    queries::set_metadata_override(&state.project().await?, &sha256, &csl_json).await
}

/// Rank chunks against a piece of text the user is writing.
///
/// Embedding and scoring both happen here; only the top results cross the IPC
/// boundary, rather than the entire corpus as before.
#[tauri::command]
pub async fn search_sources(
    state: State<'_, DbState>,
    query: String,
    limit: Option<usize>,
    include_library: Option<bool>,
) -> Result<Vec<queries::ScoredChunk>, String> {
    // embed_texts is synchronous ONNX inference with no await points; running it
    // on an async worker blocks that worker for the whole inference and can
    // starve other commands.
    let embedding =
        tokio::task::spawn_blocking(move || crate::commands::embed_texts(&[query], true))
            .await
            .map_err(|e| format!("embedding task failed: {e}"))??
            .into_iter()
            .next()
            .ok_or_else(|| "query produced no embedding".to_string())?;

    let library = state.library().await?;
    let project_hashes = match state.project().await {
        Ok(project) => queries::project_source_hashes(&project).await?,
        Err(_) => Vec::new(),
    };

    queries::search_similar(
        &library,
        &embedding,
        &project_hashes,
        limit.unwrap_or(5),
        include_library.unwrap_or(false),
    )
    .await
}

#[tauri::command]
pub async fn embedding_meta(state: State<'_, DbState>) -> Result<Option<(String, i64)>, String> {
    queries::embedding_meta(&state.library().await?).await
}

#[tauri::command]
pub async fn set_embedding_meta(
    state: State<'_, DbState>,
    model_id: String,
    dims: i64,
) -> Result<(), String> {
    queries::set_embedding_meta(&state.library().await?, &model_id, dims).await
}

/// Import metadata from the pre-hybrid database, if one exists.
///
/// The old database is only read, never modified — it stays on disk so nothing
/// is lost if the result is unsatisfactory.
#[tauri::command]
pub async fn import_legacy_metadata(
    state: State<'_, DbState>,
    legacy_db_path: String,
) -> Result<salvage::SalvageReport, String> {
    salvage::import_legacy_metadata(&state.library().await?, &PathBuf::from(legacy_db_path)).await
}

/// Metadata previously resolved for this filename, if any.
#[tauri::command]
pub async fn legacy_metadata_for(
    state: State<'_, DbState>,
    file_name: String,
) -> Result<Option<String>, String> {
    salvage::legacy_metadata_for(&state.library().await?, &file_name).await
}

#[tauri::command]
pub async fn mark_legacy_consumed(
    state: State<'_, DbState>,
    file_name: String,
) -> Result<(), String> {
    salvage::mark_legacy_consumed(&state.library().await?, &file_name).await
}
