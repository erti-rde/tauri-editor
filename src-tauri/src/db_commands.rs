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

/* ------------------------------------------------------------- annotations */

#[tauri::command]
pub async fn save_annotation(
    state: State<'_, DbState>,
    annotation: queries::NewAnnotation,
) -> Result<(), String> {
    queries::save_annotation(&state.library().await?, &annotation).await
}

#[tauri::command]
pub async fn annotations_for_source(
    state: State<'_, DbState>,
    sha256: String,
) -> Result<Vec<queries::Annotation>, String> {
    queries::annotations_for_source(&state.library().await?, &sha256).await
}

#[tauri::command]
pub async fn all_annotations(
    state: State<'_, DbState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<queries::Annotation>, String> {
    queries::all_annotations(
        &state.library().await?,
        limit.unwrap_or(200),
        offset.unwrap_or(0),
    )
    .await
}

#[tauri::command]
pub async fn delete_annotation(state: State<'_, DbState>, id: String) -> Result<(), String> {
    queries::delete_annotation(&state.library().await?, &id).await
}

#[tauri::command]
pub async fn delete_imported_annotations(
    state: State<'_, DbState>,
    sha256: String,
) -> Result<u64, String> {
    queries::delete_imported_annotations(&state.library().await?, &sha256).await
}

#[tauri::command]
pub async fn annotation_labels(
    state: State<'_, DbState>,
) -> Result<Vec<queries::AnnotationLabel>, String> {
    queries::annotation_labels(&state.library().await?).await
}

#[tauri::command]
pub async fn save_label(
    state: State<'_, DbState>,
    label: queries::AnnotationLabel,
) -> Result<(), String> {
    queries::save_label(&state.library().await?, &label).await
}

#[tauri::command]
pub async fn delete_label(state: State<'_, DbState>, id: String) -> Result<(), String> {
    queries::delete_label(&state.library().await?, &id).await
}

#[tauri::command]
pub async fn save_reading_position(
    state: State<'_, DbState>,
    sha256: String,
    page: i64,
    scroll: Option<f64>,
    scale: Option<String>,
) -> Result<(), String> {
    queries::save_reading_position(
        &state.library().await?,
        &sha256,
        page,
        scroll,
        scale.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn reading_position(
    state: State<'_, DbState>,
    sha256: String,
) -> Result<Option<i64>, String> {
    queries::reading_position(&state.library().await?, &sha256).await
}

#[tauri::command]
pub async fn path_for_source(
    state: State<'_, DbState>,
    sha256: String,
) -> Result<Option<String>, String> {
    queries::path_for_source(&state.library().await?, &sha256).await
}

#[tauri::command]
pub async fn source_for_path(
    state: State<'_, DbState>,
    path: String,
) -> Result<Option<String>, String> {
    queries::source_for_path(&state.library().await?, &path).await
}

#[tauri::command]
pub async fn save_annotation_image(
    state: State<'_, DbState>,
    id: String,
    png: Vec<u8>,
) -> Result<(), String> {
    queries::save_annotation_image(&state.library().await?, &id, &png).await
}

#[tauri::command]
pub async fn annotation_image(
    state: State<'_, DbState>,
    id: String,
) -> Result<Option<Vec<u8>>, String> {
    queries::annotation_image(&state.library().await?, &id).await
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
pub async fn embed_annotation(
    state: State<'_, DbState>,
    id: String,
    text: String,
) -> Result<bool, String> {
    let library = state.library().await?;

    let hash = {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(text.as_bytes());
        format!("{:x}", hasher.finalize())
    };

    if queries::annotation_embedding_hash(&library, &id).await? == Some(hash.clone()) {
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
            .map_err(|e| format!("embedding task failed: {e}"))??
            .into_iter()
            .next()
            .ok_or_else(|| "the mark produced no embedding".to_string())?;

    queries::save_annotation_embedding(&library, &id, &embedding, &hash).await?;

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
pub async fn embed_pending_annotations(state: State<'_, DbState>) -> Result<usize, String> {
    let library = state.library().await?;

    // Bounded: a first run over a large library should take a moment and finish,
    // not hold the model for a minute. Running it again picks up the rest.
    let pending = queries::annotations_needing_embedding(&library, 500).await?;
    if pending.is_empty() {
        return Ok(0);
    }

    let (ids, texts): (Vec<String>, Vec<String>) = pending.into_iter().unzip();

    // One batch rather than one inference per mark: the model is loaded once and
    // the tokeniser pads the whole set together.
    let embeddings =
        tokio::task::spawn_blocking(move || crate::commands::embed_texts(&texts, true))
            .await
            .map_err(|e| format!("embedding task failed: {e}"))??;

    let mut done = 0;
    for (id, embedding) in ids.iter().zip(embeddings.iter()) {
        // A hash of nothing: these are backfills, and the next real edit
        // re-embeds them under the hash of whatever it then says.
        queries::save_annotation_embedding(&library, id, embedding, "backfilled").await?;
        done += 1;
    }

    Ok(done)
}

/// Find marks, by their words or by what they are about.
///
/// Deliberately separate from `search_sources`. A passage from a paper and a
/// note the researcher wrote are not the same kind of thing — one is quotable,
/// the other is a judgement already made — and a 12-word note does not produce
/// a cosine score comparable with a 100-word passage, so merging the two into
/// one ranked list would be quietly wrong in a way nobody could see.
#[tauri::command]
pub async fn search_annotations(
    state: State<'_, DbState>,
    query: String,
    limit: Option<i64>,
    semantic: Option<bool>,
) -> Result<Vec<queries::ScoredAnnotation>, String> {
    let library = state.library().await?;

    let project_hashes = match state.project().await {
        Ok(project) => queries::project_source_hashes(&project).await?,
        Err(_) => Vec::new(),
    };

    let limit = limit.unwrap_or(50);

    if !semantic.unwrap_or(false) {
        return queries::search_annotations_literally(&library, &query, &project_hashes, limit)
            .await;
    }

    let embedding =
        tokio::task::spawn_blocking(move || crate::commands::embed_texts(&[query], true))
            .await
            .map_err(|e| format!("embedding task failed: {e}"))??
            .into_iter()
            .next()
            .ok_or_else(|| "the query produced no embedding".to_string())?;

    queries::search_annotations_semantically(&library, &embedding, &project_hashes, limit as usize)
        .await
}

#[tauri::command]
pub async fn restore_default_labels(state: State<'_, DbState>) -> Result<u64, String> {
    queries::restore_default_labels(&state.library().await?).await
}

#[tauri::command]
pub async fn name_labels_after_colours(state: State<'_, DbState>) -> Result<u64, String> {
    queries::name_labels_after_colours(&state.library().await?).await
}
