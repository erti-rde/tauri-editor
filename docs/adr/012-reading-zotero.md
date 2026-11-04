# ADR 012 — Reading Zotero from a copy of its database

**Status:** Accepted, 2026-11-04 (M1b-11).

## Context

Most of Erti's researchers keep their papers in Zotero. Getting them into a project meant
exporting a collection with Better BibTeX, importing the `.bib`, then showing Erti where Zotero
keeps the PDFs (M1b-9). The maintainer asked for one place instead: **New project…** shows the
Zotero library as a tree, the user ticks collections and papers, and the project follows them,
with the PDFs left where Zotero keeps them.

Checked on the maintainer's machine, 2026-11-04, Zotero 10.0.7 (`userdata` schema 130):

- Zotero keeps `zotero.sqlite` in WAL mode and holds a lock on it while it runs. Opening it
  read-only in place fails with "database is locked".
- Copying `zotero.sqlite` together with `zotero.sqlite-wal` and opening the copy works while
  Zotero runs.
- Stored PDFs are `itemAttachments.path = 'storage:<file>'`, at `<data>/storage/<item key>/<file>`
  (link modes 0 and 1). Linked files (mode 2) are absolute paths; those under Zotero's "base
  directory" are `attachments:<relative>`, the base being a preference in Zotero's profile,
  not in the data folder.

## Decision

- **Rust reads a copy of the database.** `src-tauri/src/zotero/` copies `zotero.sqlite` and its
  `-wal` into Erti's cache folder, opens the copy read-only with `sqlx`, and checks it with
  `PRAGMA quick_check`. A torn copy (Zotero wrote mid-copy) is taken again once; a second
  failure is "Zotero is busy". Before any query, the tables and columns Erti reads are checked
  with `pragma table_info`; a database without them is refused, so a future Zotero that
  reshapes its tables gives a plain message, never a wrong or empty tree. The copy is reused
  while Zotero's two files are unchanged, so opening a collection doesn't copy the library
  again; a newer copy replaces it, a failed copy is deleted at once, and copies an earlier run
  of Erti left are deleted at its first read.
- **The mapping to CSL is TS's**, from the Zotero schema's own `csl` maps that Erti already
  ships (`resources/csl/schema.json`, `adapterCslZotero.ts`). Rust returns raw fields and
  creators; `src/lib/import/zotero.ts` turns them into `ImportEntry`s, and from there the
  bibliography import (M1b-9) does the rest: dedupe, `import_sources`, progress.
- **The webview never names a path into Zotero.** Rust finds the default data folder itself
  (`~/Zotero`). Any other comes from the folder dialog and passes `scope::authorise_directory`.
  The folder is kept in `library.db` (library migration 7), since it belongs to the person, not
  a project. Attachments are named to Rust by Zotero's keys, and Rust resolves the path from the
  database: `storage:` under the linked folder, a linked file as Zotero records it (PDF only).
  Once attached, the path is a recorded location, which the existing scope rule opens in later
  sessions. `attachments:` paths aren't attached in 1.0; the preview says why.
- **A project follows what was ticked.** Project migration 3 adds `zotero_follow` (collections
  and items, by Zotero key, with their library) and `zotero_imported` (Zotero item key → work).
  **Sync with Zotero** is asked for, never automatic: it imports what's new, attaches PDFs
  added since, and removes nothing.

## Rejected

- **Zotero's local API** (`http://localhost:23119/api/`, Zotero 7 and later). It returns
  CSL-JSON directly, but it's a network host in the CSP and the README, it's off until the user
  turns it on in Zotero's settings, and it needs Zotero running. Reading the database needs
  none of that.
- **Opening the database in place** (`?mode=ro`, `?immutable=1`). Locked while Zotero runs;
  `immutable` ignores the WAL, so it reads a stale library.
- **A Better BibTeX export** (the path before this ADR). It needs a plugin and a file to keep
  current, and it's two places, not one.

## Consequences

- Erti depends on Zotero's table layout. The column check turns a change into a message, and
  the test fixture is the real Zotero 10 layout (`src-tauri/tests/fixtures/zotero/schema.sql`),
  so updating for a new Zotero is replacing that file and seeing what fails.
- A script in the webview (T1) can make Erti read the user's Zotero library and attach PDFs from
  it, but can't point Erti anywhere else: the folder is Rust's default or a dialog pick, and
  every attachment path comes from the database. security.md T2 says so.
- Metadata edited in Zotero after the import isn't brought across by a sync (plan-v1.md §5).
