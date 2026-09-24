use crate::ml::ML_STATE;
use base64::{engine::general_purpose::STANDARD, Engine};
use core::future::Future;
use core::pin::Pin;
use ndarray::{Array2, Axis, Ix2};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::fs as tokio_fs;

use crate::ipc::AppError;

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct FileItem {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FileItem>>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct EmbeddingResult {
    chunk_text: String,
    embedding: Vec<f32>,
}

// Helper function to handle the recursive part
fn read_directory_impl(
    path: String,
) -> Pin<Box<dyn Future<Output = Result<Vec<FileItem>, AppError>> + Send>> {
    Box::pin(async move {
        let path = Path::new(&path);

        // No exists() preflight: it reports false when the metadata call is
        // itself denied, so a folder Erti simply lacks permission to read would
        // be described as missing — which is the opposite of the guidance this
        // path exists to give. read_dir distinguishes the two.

        let mut items = Vec::new();

        let read_dir = tokio_fs::read_dir(path)
            .await
            .map_err(|e| AppError::from_io(&e, path))?;
        let mut read_dir = read_dir;

        while let Ok(Some(entry)) = read_dir.next_entry().await {
            let path_buf = entry.path();
            let file_type = entry
                .file_type()
                .await
                .map_err(|e| AppError::from_io(&e, &path_buf))?;
            let is_dir = file_type.is_dir();
            let name = entry.file_name().to_string_lossy().to_string();

            // Skip hidden files (Unix-style)
            if name.starts_with('.') {
                continue;
            }

            let children = if is_dir {
                // An unreadable subdirectory is reported as having no children rather
                // than failing the whole listing.
                read_directory_impl(path_buf.to_string_lossy().to_string())
                    .await
                    .ok()
            } else {
                None
            };

            items.push(FileItem {
                name,
                path: path_buf.to_string_lossy().to_string(),
                is_dir,
                children,
            });
        }

        // Sort directories first, then files, both alphabetically
        items.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });

        Ok(items)
    })
}

// The actual command that will be exposed to Tauri
#[tauri::command]
#[specta::specta]
pub async fn read_directory(path: String) -> Result<Vec<FileItem>, AppError> {
    read_directory_impl(path).await
}

#[tauri::command]
#[specta::specta]
pub async fn read_pdf_file(path: String) -> Result<String, AppError> {
    let data = std::fs::read(&path).map_err(|e| AppError::from_io(&e, Path::new(&path)))?;
    Ok(STANDARD.encode(data))
}

/// Embed a batch of texts, returning one vector per input.
///
/// Shared by the `embed_chunks` command and the retrieval benchmark so both
/// measure and use the same inference path.
///
/// `add_special_tokens` controls whether the tokenizer's `[CLS] … [SEP]` template
/// is applied. sentence-transformers embeds *with* them; the original call site
/// passed `false`, which silently drops them. The benchmark treats this as a
/// variable so the difference can be measured rather than guessed at.
pub fn embed_texts(texts: &[String], add_special_tokens: bool) -> Result<Vec<Vec<f32>>, String> {
    let ml_state = ML_STATE
        .get()
        .ok_or_else(|| "ML state not initialized".to_string())?;

    if texts.is_empty() {
        return Ok(Vec::new());
    }

    // The tokenizer is configured with fixed padding and truncation at 128 tokens,
    // so every encoding comes back the same length regardless of input size.
    let encodings = ml_state
        .tokenizer
        .encode_batch(texts.to_vec(), add_special_tokens)
        .map_err(|e| e.to_string())?;

    let padded_token_length = encodings[0].len();

    let ids: Vec<i64> = encodings
        .iter()
        .flat_map(|e| e.get_ids().iter().map(|i| *i as i64))
        .collect();
    let mask: Vec<i64> = encodings
        .iter()
        .flat_map(|e| e.get_attention_mask().iter().map(|i| *i as i64))
        .collect();

    let a_ids = Array2::from_shape_vec([texts.len(), padded_token_length], ids)
        .map_err(|e| e.to_string())?;
    let a_mask = Array2::from_shape_vec([texts.len(), padded_token_length], mask)
        .map_err(|e| e.to_string())?;

    let outputs = ml_state
        .session
        .run(ort::inputs![a_ids, a_mask].map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;

    // Output 1 is `sentence_embedding`: this ONNX export bakes the
    // sentence-transformers mean-pooling head in, so no pooling is needed here.
    let embeddings = outputs[1]
        .try_extract_tensor::<f32>()
        .map_err(|e| e.to_string())?
        .into_dimensionality::<Ix2>()
        .map_err(|e| e.to_string())?;

    Ok((0..texts.len())
        .map(|i| embeddings.index_axis(Axis(0), i).to_vec())
        .collect())
}

/// Cosine similarity between two equal-length vectors. Returns 0 for a zero vector.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }
    let (mut dot, mut na, mut nb) = (0.0f32, 0.0f32, 0.0f32);
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    let denom = na.sqrt() * nb.sqrt();
    if denom == 0.0 {
        0.0
    } else {
        dot / denom
    }
}

#[tauri::command]
#[specta::specta]
pub async fn embed_chunks(chunks: Vec<String>) -> Result<Vec<EmbeddingResult>, AppError> {
    // Ingest embeds hundreds of chunks per document. Off the async workers, as
    // above: this is CPU-bound inference with no await points.
    tokio::task::spawn_blocking(move || embed_chunks_blocking(chunks))
        .await
        .map_err(AppError::internal)?
        .map_err(AppError::model)
}

fn embed_chunks_blocking(chunks: Vec<String>) -> Result<Vec<EmbeddingResult>, String> {
    // `true` applies the tokenizer's [CLS] … [SEP] template, matching how
    // sentence-transformers embeds text. This previously passed `false`; the
    // retrieval benchmark measures the difference as small but consistently
    // positive (MRR 0.890 -> 0.900), and it costs nothing.
    let embeddings = embed_texts(&chunks, true)?;

    Ok(chunks
        .into_iter()
        .zip(embeddings)
        .map(|(chunk_text, embedding)| EmbeddingResult {
            chunk_text,
            embedding,
        })
        .collect())
}
