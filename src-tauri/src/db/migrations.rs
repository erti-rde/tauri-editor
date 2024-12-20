use tauri_plugin_sql::{Migration, MigrationKind};

pub fn get_migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create_initial_tables",
        sql: r#"
                        CREATE TABLE documents (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            file_name TEXT NOT NULL,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        );

                        CREATE TABLE chunks (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            document_id INTEGER NOT NULL,
                            chunk_text TEXT NOT NULL,
                            embedding BLOB NOT NULL,  -- Store embeddings as binary data
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            FOREIGN KEY (document_id) REFERENCES documents(id)
                        );

                        -- Create indexes for better query performance
                        CREATE INDEX idx_documents_file_name ON documents(file_name);
                        CREATE INDEX idx_chunks_document_id ON chunks(document_id);
                    "#,
        kind: MigrationKind::Up,
    }]
}
