use ort::{
    execution_providers::CUDAExecutionProvider, session::builder::GraphOptimizationLevel,
    session::Session,
};
use std::sync::Arc;
use tokenizers::Tokenizer;
use tokio::sync::OnceCell;

pub struct MLState {
    pub session: Session,
    pub tokenizer: Tokenizer,
}

// Global static instance
pub static ML_STATE: OnceCell<Arc<MLState>> = OnceCell::const_new();

pub async fn initialize_ml_state(resource_dir: &str) -> Result<(), String> {
    let llm_path = std::path::Path::new(resource_dir).join("all-MiniLM-L6-v2");
    let onnx_path = std::path::Path::new(&llm_path).join("model.onnx");
    let tokenizer_path = std::path::Path::new(&llm_path).join("tokenizer.json");

    // Initialize ORT
    ort::init()
        .with_name("sbert")
        .with_execution_providers([CUDAExecutionProvider::default().build()])
        .commit()
        .map_err(|e| e.to_string())?;

    // Initialize session
    let session = Session::builder()
        .map_err(|e| e.to_string())?
        .with_optimization_level(GraphOptimizationLevel::Level1)
        .map_err(|e| e.to_string())?
        .with_intra_threads(1)
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
