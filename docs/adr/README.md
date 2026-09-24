# Architecture decisions

Decisions that shape Erti's data, formats and boundaries, one file each. A decision is changed by
a new ADR that supersedes it, never by editing the old one, for the same reason shipped
migrations are frozen: someone's files were built on it.

Format: **Context** (what forces the decision) · **Decision** · **Alternatives** (and why not) ·
**Consequences** (what gets easier, what gets harder, what must now be true).

| #                                                 | Decision                                                   | Status   | Milestone |
| ------------------------------------------------- | ---------------------------------------------------------- | -------- | --------- |
| [001](001-layering.md)                            | Pure TS for document transforms, Rust for data and vectors | Accepted | all       |
| [002](002-manuscript-file-format.md)              | A versioned manuscript envelope that carries its sources   | Accepted | M1a       |
| [003](003-source-identity.md)                     | Works and files: one id per work, aliases for the rest     | Accepted | M1b       |
| [004](004-source-notes.md)                        | Source notes as their own table in the library             | Accepted | M1b       |
| [005](005-retrieval-index.md)                     | An in-memory vector index in Rust, rebuilt from SQLite     | Accepted | M2        |
| [006](006-attribution-matching.md)                | Index the manuscript, stream the corpus                    | Accepted | M4        |
| [007](007-version-history.md)                     | Snapshots as plain manuscript files under `.erti/history/` | Accepted | M5        |
| [008](008-library-backups.md)                     | Rotating library backups with `VACUUM INTO`                | Accepted | M1a       |
| [009](009-docx-export-and-bibliography-import.md) | DOCX export and bibliography import as pure TS modules     | Accepted | M1b, M5   |
| [010](010-design-system.md)                       | One token source, a primitive layer, a catalogue           | Accepted | M1c       |
