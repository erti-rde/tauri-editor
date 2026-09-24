# ADR 007 — Snapshots as plain manuscript files under `.erti/history/`

**Status:** Accepted, 2026-09-24.

## Context

Autosave overwrites the manuscript in place. There's no way back from a deleted section once
the quiet period has passed. "Nothing the user writes can be lost" is a 1.0 criterion.

## Decision

- Snapshots are **ordinary manuscript files** (ADR 002 envelopes) at
  `<project>/.erti/history/<document stem>/<UTC timestamp>.erti.json`. A snapshot can be opened,
  diffed, or copied back by hand, even without Erti.
- **Taken** at most every 10 minutes while a document changes; when a document is closed or the
  app quits; and **always** before a restore, an import that replaces content, or any other
  destructive operation.
- **Thinned** by age: all from the last day, hourly for a week, daily for three months, weekly
  after that. It's done by Rust on project open, never on the typing path.
- **Restore** snapshots the current state first and is therefore undoable. The UI lists
  snapshots with time and word-count delta, and previews before restoring.
- Renaming or deleting a document (M5) moves or keeps its history directory. Deleting the
  document doesn't delete its history.

## Alternatives

- **Snapshots in `project.db`.** Atomic and compact, but opaque. If the database is damaged,
  the history goes with it, which is exactly when it's needed.
- **Git in the project folder.** Powerful, but a hard dependency, and it conflicts with users
  who already version their folder.
- **Rely on OS backups / cloud sync.** Not every researcher has one, and it's out of Erti's
  control.

## Consequences

- `.erti/` grows. A 50-page manuscript is ~300 KB of JSON, and thinning bounds it to roughly a
  few hundred snapshots. The UI shows the size and allows clearing old ones.
- Synced folders sync history too. That's desirable for recovery and noisy for co-authors, so
  the README documents it.
