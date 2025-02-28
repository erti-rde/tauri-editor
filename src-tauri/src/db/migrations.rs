use tauri_plugin_sql::{Migration, MigrationKind};

pub fn get_migrations() -> Vec<Migration> {
    vec![
        Migration {
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
        },
        Migration {
            version: 2,
            description: "Add DOI/ID to documents table as unique identifier",
            sql: r#"
                        ALTER TABLE documents ADD COLUMN doi TEXT;
                    "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "Add cascade delete for document chunks and make doi unique",
            sql: r#"
                -- Temporarily disable foreign key constraints
                PRAGMA foreign_keys=off;

                -- First handle the documents table (since chunks reference it)
                CREATE TABLE documents_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_name TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    doi TEXT UNIQUE
                );

                -- Copy data from original documents table
                INSERT INTO documents_new SELECT * FROM documents;

                -- Drop original documents table
                DROP TABLE documents;

                -- Rename new documents table to original name
                ALTER TABLE documents_new RENAME TO documents;

                -- Recreate index for documents
                CREATE INDEX idx_documents_file_name ON documents(file_name);

                -- Now handle the chunks table
                CREATE TABLE chunks_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    document_id INTEGER NOT NULL,
                    chunk_text TEXT NOT NULL,
                    embedding BLOB NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
                );

                -- Copy only valid data from original chunks table
                -- This ensures we don't violate the foreign key constraint
                INSERT INTO chunks_new
                SELECT c.* FROM chunks c
                INNER JOIN documents d ON c.document_id = d.id;

                -- Drop original chunks table
                DROP TABLE chunks;

                -- Rename new chunks table to original name
                ALTER TABLE chunks_new RENAME TO chunks;

                -- Recreate index for chunks
                CREATE INDEX idx_chunks_document_id ON chunks(document_id);

                -- Re-enable foreign key constraints
                PRAGMA foreign_keys=on;
            "#,
            kind: MigrationKind::Up,
        }
    ]
}
