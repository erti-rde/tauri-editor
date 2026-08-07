pub mod commands;
pub mod db;
pub mod db_commands;
pub mod fs_errors;
pub mod ml;

use commands::*;
use db_commands::*;
use tauri::path::BaseDirectory;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        // Databases are opened on demand rather than through tauri-plugin-sql:
        // the project database lives at <project>/.erti/project.db, a path not
        // known until the user opens a folder, which a build-time connection
        // string cannot express.
        .manage(db::DbState::default())
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
            embed_chunks,
            // Database surface — no statement is accepted from the frontend.
            open_library,
            open_project,
            project_root,
            hash_file,
            register_source,
            sources_needing_ingest,
            store_chunks,
            mark_ingest_failed,
            set_source_metadata,
            project_sources,
            add_to_project,
            set_metadata_override,
            search_sources,
            embedding_meta,
            set_embedding_meta,
            import_legacy_metadata,
            legacy_metadata_for,
            mark_legacy_consumed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
