use ort::{session::builder::GraphOptimizationLevel, session::Session};
use std::sync::Arc;
use tokenizers::Tokenizer;
use tokio::sync::OnceCell;

pub struct MLState {
    pub session: Session,
    pub tokenizer: Tokenizer,
}

// Global static instance
pub static ML_STATE: OnceCell<Arc<MLState>> = OnceCell::const_new();

/// Threads ONNX Runtime may use within a single operator.
///
/// Embedding a corpus is the slowest part of ingest and is pure CPU work, so it
/// should use the machine. One core is left free so the UI stays responsive
/// while a large folder is being processed.
fn intra_op_threads() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get().saturating_sub(1).max(1))
        .unwrap_or(1)
}

pub async fn initialize_ml_state(resource_dir: &str) -> Result<(), String> {
    let llm_path = std::path::Path::new(resource_dir).join("all-MiniLM-L6-v2");
    let onnx_path = std::path::Path::new(&llm_path).join("model.onnx");
    let tokenizer_path = std::path::Path::new(&llm_path).join("tokenizer.json");

    // No execution provider is registered on purpose. None of ort's EP features
    // (`coreml`, `cuda`, `directml`) are enabled in Cargo.toml, so registering one
    // here silently does nothing and falls back to CPU — which is what the previous
    // `CUDAExecutionProvider` call was doing on every platform, macOS included.
    // Enabling an accelerator is worthwhile, but belongs with the throughput
    // benchmark that can demonstrate it actually helps.
    ort::init()
        .with_name("sbert")
        .commit()
        .map_err(|e| e.to_string())?;

    // Initialize session
    let session = Session::builder()
        .map_err(|e| e.to_string())?
        // Level3 applies all available graph optimisations; Level1 left
        // layout and transformer-specific fusions unused.
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| e.to_string())?
        .with_intra_threads(intra_op_threads())
        .map_err(|e| e.to_string())?
        .commit_from_file(onnx_path)
        .map_err(|e| e.to_string())?;

    // Initialize tokenizer
    let tokenizer = Tokenizer::from_file(tokenizer_path).map_err(|e| e.to_string())?;

    let state = MLState { session, tokenizer };

    ML_STATE
        .set(Arc::new(state))
        .map_err(|_| "ML state already initialized".to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::intra_op_threads;

    #[test]
    fn intra_op_threads_uses_the_machine_but_leaves_headroom() {
        let n = intra_op_threads();
        assert!(n >= 1, "must always request at least one thread");

        if let Ok(available) = std::thread::available_parallelism() {
            assert!(n <= available.get(), "must not oversubscribe");
            if available.get() > 1 {
                assert_eq!(n, available.get() - 1, "should leave one core for the UI");
            }
        }
    }
}
