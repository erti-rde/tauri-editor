use base64::{engine::general_purpose::STANDARD, Engine};
use core::future::Future;
use core::pin::Pin;
use headless_chrome::{types::PrintToPdfOptions, Browser, LaunchOptions};
use serde::{Deserialize, Serialize};
use std::fs;
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

#[tauri::command]
pub async fn read_pdf_file(path: String) -> Result<String, String> {
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(data))
}

#[tauri::command]
pub async fn print_pdf_file(current_dir: String) -> Result<(), String> {
    let html_path = Path::new(&current_dir)
        .join("magnum_opus.html")
        .to_string_lossy()
        .to_string();

    let file_path = format!("file://{}", html_path);

    let browser = Browser::new(LaunchOptions::default_builder().build().unwrap())
        .map_err(|e| e.to_string())?;
    let tab = browser.new_tab().map_err(|e| e.to_string())?;

    // Browse to the file url and render a pdf of the web page.
    let pdf_options: Option<PrintToPdfOptions> = None; // use chrome's defaults for this example
    let local_pdf = tab
        .navigate_to(&file_path)
        .map_err(|e| e.to_string())?
        .wait_until_navigated()
        .map_err(|e| e.to_string())?
        .print_to_pdf(pdf_options)
        .map_err(|e| e.to_string())?;
    let path_to_save = Path::new(&current_dir)
        .join("opus.pdf")
        .to_string_lossy()
        .to_string();
    fs::write(path_to_save, local_pdf).map_err(|e| e.to_string())?;
    println!("PDF successfully created from local web page.");

    Ok(())
}
