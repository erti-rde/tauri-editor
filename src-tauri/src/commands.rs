use core::future::Future;
use core::pin::Pin;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::fs as tokio_fs;

#[derive(Debug, Serialize, Deserialize)]
pub struct FileItem {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FileItem>>,
}

// Helper function to handle the recursive part
fn read_directory_impl(
    path: String,
) -> Pin<Box<dyn Future<Output = Result<Vec<FileItem>, String>> + Send>> {
    Box::pin(async move {
        let path = Path::new(&path);

        if !path.exists() {
            return Err("Directory does not exist".to_string());
        }

        let mut items = Vec::new();

        let read_dir = tokio_fs::read_dir(path).await.map_err(|e| e.to_string())?;
        let mut read_dir = read_dir;

        while let Ok(Some(entry)) = read_dir.next_entry().await {
            let path_buf = entry.path();
            let file_type = entry.file_type().await.map_err(|e| e.to_string())?;
            let is_dir = file_type.is_dir();
            let name = entry.file_name().to_string_lossy().to_string();

            // Skip hidden files (Unix-style)
            if name.starts_with('.') {
                continue;
            }

            let children = if is_dir {
                // Recursive call using the implementation function
                match read_directory_impl(path_buf.to_string_lossy().to_string()).await {
                    Ok(children) => Some(children),
                    Err(_) => None,
                }
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
pub async fn read_directory(path: String) -> Result<Vec<FileItem>, String> {
    read_directory_impl(path).await
}
