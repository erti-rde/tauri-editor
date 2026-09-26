pub mod commands;
pub mod db;
pub mod db_commands;
pub mod fs_errors;
pub mod ipc;
pub mod latex;
pub mod ml;
pub mod scope;

use commands::*;
use db_commands::*;
use tauri::path::BaseDirectory;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Development builds keep the TypeScript bindings in step with the Rust
    // commands. CI checks they are committed up to date (`bindings_are_current`).
    #[cfg(debug_assertions)]
    export_bindings(std::path::Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../src/lib/ipc/bindings.ts"
    )))
    .expect("failed to export the TypeScript bindings");

    tauri::Builder::default()
        // First, so everything after it can log (M1a-12).
        .plugin(logger())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        // Databases are opened on demand rather than through tauri-plugin-sql:
        // the project database lives at <project>/.erti/project.db, a path not
        // known until the user opens a folder, which a build-time connection
        // string cannot express.
        .manage(db::DbState::default())
        .setup(|app| {
            log::info!(
                "Erti {} started on {} {}",
                app.package_info().version,
                std::env::consts::OS,
                std::env::consts::ARCH
            );

            // A folder or file the user picks in a dialog is theirs to hand to
            // Erti. The dialog plugin announces each pick through the fs scope;
            // the path commands accept it for the rest of the session (M1a-3).
            let grants = app.state::<db::DbState>().grants.clone();
            app.fs_scope().listen(move |event| {
                if let tauri::scope::fs::Event::PathAllowed(path) = event {
                    grants.grant(path);
                }
            });

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
                    log::error!("Failed to initialize ML state: {e}");
                    handle.exit(1);
                }
            });

            Ok(())
        })
        // Every command, registered once, through the typed builder: the same
        // list generates `src/lib/ipc/bindings.ts` (ADR 011).
        .invoke_handler(ipc_builder().invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// One log file, Rust's and the webview's lines together (M1a-12).
///
/// It stays on the machine: the log directory, and the terminal in a debug
/// build. One file, started afresh when it passes 2 MB, so it never grows
/// without bound and there's only one thing to attach to a bug report. Times
/// are UTC: the plugin can't read the local offset from a multithreaded
/// process on Unix, and a setting asking for local time falls back to UTC.
///
/// What goes in is Erti's own account of what it did. Crates that log what
/// they were given are held to warnings: sqlx logs each statement at debug.
fn logger() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use log::LevelFilter;
    use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

    let mut targets = vec![Target::new(TargetKind::LogDir { file_name: None })];
    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stdout));
    }
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets(targets)
        .level(LevelFilter::Info)
        .level_for("sqlx", LevelFilter::Warn)
        .level_for("ort", LevelFilter::Warn)
        .level_for("tokenizers", LevelFilter::Warn)
        .max_file_size(2_000_000)
        .rotation_strategy(RotationStrategy::KeepOne)
        .build()
}

/// Every command the webview can call, in one place (ADR 011).
///
/// Tauri's generated command helpers are only visible inside this crate, so the
/// list lives here rather than in a test or a build script.
pub fn ipc_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
        read_directory,
        open_log_folder,
        read_pdf_file,
        embed_chunks,
        // Database surface. No statement is accepted from the frontend.
        open_library,
        open_project,
        project_root,
        hash_file,
        register_source,
        latex::detect_tex_toolchain,
        latex::compile_latex,
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
        save_annotation,
        annotations_for_source,
        all_annotations,
        delete_annotation,
        delete_imported_annotations,
        annotation_labels,
        save_label,
        delete_label,
        save_reading_position,
        reading_position,
        path_for_source,
        source_for_path,
        save_annotation_image,
        annotation_image,
        embed_annotation,
        embed_pending_annotations,
        search_annotations,
        restore_default_labels,
        name_labels_after_colours,
    ])
}

/// The generated TypeScript, as text.
pub fn bindings() -> Result<String, String> {
    let out = std::env::temp_dir().join(format!("erti-bindings-{}.ts", std::process::id()));
    export_bindings(&out)?;
    let text = std::fs::read_to_string(&out).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&out);
    Ok(text)
}

/// Write the TypeScript bindings for every command to `path`.
pub fn export_bindings(path: &std::path::Path) -> Result<(), String> {
    ipc_builder()
        .export(
            specta_typescript::Typescript::default()
                .header("// Generated by tauri-specta from src-tauri (ADR 011). Do not edit.\n// @ts-nocheck"),
            path,
        )
        .map_err(|e| e.to_string())
}
