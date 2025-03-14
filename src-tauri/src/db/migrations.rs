use tauri_plugin_sql::{Migration, MigrationKind};

pub fn get_migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create_initial_tables",
        kind: MigrationKind::Up,
        sql: r#"
            -- Enable foreign key constraints
            PRAGMA foreign_keys = ON;

            CREATE TABLE files (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 file_name TEXT NOT NULL UNIQUE,
                 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE chunks (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 file_id INTEGER NOT NULL,
                 chunk_text TEXT NOT NULL,
                 embedding BLOB NOT NULL,
                 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                 FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
            );

            CREATE TABLE source_metadata (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NULL,
                zotero_type TEXT NULL,
                metadata TEXT NULL, -- Stringified JSON
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
            );

            -- Create indexes for better query performance

            CREATE INDEX idx_files_file_name ON files(file_name);
            CREATE INDEX idx_chunks_file_id ON chunks(file_id);
            CREATE INDEX idx_source_metadata_file_id ON source_metadata(file_id);
             "#,
    }]
}
