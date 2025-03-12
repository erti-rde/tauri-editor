mod commands;
mod db;
mod ml;

use commands::*;
use tauri::path::BaseDirectory;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(
                    "sqlite:magnum_opus_test.db",
                    db::migrations::get_migrations(),
                )
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Get the resource dir from the app context
            let resource_dir = app
                .path()
                .resolve("resources", BaseDirectory::Resource)
                .expect("failed to get resource dir")
                .to_string_lossy()
                .to_string();

            // Spawn the ML state initialization in a separate task
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = ml::initialize_ml_state(&resource_dir).await {
                    eprintln!("Failed to initialize ML state: {}", e);
                    handle.exit(1);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_directory,
            read_pdf_file,
            print_pdf_file,
            embed_chunks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
