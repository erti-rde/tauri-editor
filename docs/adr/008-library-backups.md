# ADR 008 — Rotating library backups with `VACUUM INTO`

**Status:** Accepted, 2026-09-24. Found during the architecture review; not in the first draft
of plan-v1.md.

## Context

Since the reader shipped, `~/Erti/library.db` holds work that can't be regenerated:
highlights, notes, labels, reading positions, metadata corrections, and (from M1) source notes and
no-file sources. It's a single SQLite file with no backup. Chunks and embeddings can be
re-ingested; the rest can't.

## Decision

- On library open, if the newest backup is older than 24 hours, Rust writes
  `VACUUM INTO '<library dir>/backups/library-<UTC date>.db'`. That produces a consistent,
  compacted copy without stopping writers.
- **Before every library migration**, a backup is taken unconditionally.
- Keep 7 daily and 4 weekly backups. Older ones are deleted.
- Settings shows the backup folder, the last backup time, and "Back up now" / "Restore from…".
  Restoring closes the library, copies the backup into place (keeping the replaced file as
  `library-replaced-<ts>.db`), and reopens.
- `chunks` dominate the file size. If backups grow past a budget measured in M6, back up with
  chunk text and embeddings stripped, since those are rebuildable by re-ingest.

## Alternatives

- **Rely on the Markdown/JSON notes export.** It doesn't cover metadata corrections, labels or
  sources, and it's manual.
- **The SQLite online backup API.** Equivalent here. `VACUUM INTO` is one statement through sqlx.

## Consequences

- An upgrade that goes wrong is recoverable. That changes how safely the frozen-migration
  scheme can be evolved.
- Disk use is about 11× the library at worst, before any stripping. M6 measures it on a
  200-paper library.
