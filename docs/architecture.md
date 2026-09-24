# How Erti is built

A map for whoever builds the next thing: where each concern lives, how data moves, the rules
that must not break, and step-by-step recipes for the changes that come up again and again.
The decisions behind it are in [adr/](adr/README.md). Where a recipe will change once a
planned item lands, it says so.

## The shape

```
┌──────────────────────── webview (SvelteKit, Svelte 5, TipTap, pdf.js) ────────────────────────┐
│ routes/+page.svelte   landing → project → workspace; owns the rail and which panel is open    │
│ lib/workspace         tabs + split view                 lib/editor     manuscript (TipTap)    │
│ lib/pdfreader         reader, marks, labels             lib/notes      Notes panel, follow     │
│ lib/metadata-explorer Sources view + edit sidebar       lib/outline    table of contents       │
│ lib/ingest            PURE: extract, chunk, resolve, pipeline decisions                        │
│ lib/citations         PURE: citeproc engine, whole-document render, sanitize                   │
│ lib/export            PURE: LaTeX, BibTeX              lib/theme      tokens, palettes, contrast│
│ lib/ui                primitives (M1c grows these)     lib/stores     app state + IPC wrappers  │
└───────────────────────────────────────┬───────────────────────────────────────────────────────┘
                                        │ lib/ipc: 42 typed commands (ADR 011); only results cross, never vectors
┌─────────────────────────────── Rust core (src-tauri/src) ─────────────────────────────────────┐
│ lib.rs            plugins, managed state, the command list (generate_handler!)                │
│ db_commands.rs    commands over the two databases        commands.rs   fs listing, embedding   │
│ db/schema.rs      migrations (frozen)  db/queries.rs     every SQL statement, similarity       │
│ ml/mod.rs         ONNX session (all-MiniLM-L6-v2)        latex.rs      detect + compile TeX    │
│ fs_errors.rs      human messages for OS errors                                                 │
└───────────────┬──────────────────────────────────────┬────────────────────────────────────────┘
        ~/Erti/library.db                        <project>/.erti/project.db
   sources, chunks, annotations, labels,     documents, source_set, metadata overrides,
   reading positions (follows the paper)     settings (belongs to the folder)
```

Manuscripts are files, not rows: `<project>/*.erti.json`. The folder is the source of truth
for which documents exist. Settings that belong to the person (style, consent, appearance) live
in the Tauri store `settings-store.json`.

## How data moves

- **Opening a project.** `Landing` → `+page.svelte` calls `open_library` (creates/migrates
  `library.db`) and `open_project` (creates/migrates `.erti/project.db`) → `read_directory` →
  Explorer. `utils/pdf_handlers.ts` then ingests new or unfinished PDFs.
- **Ingest.** `hash_file` (identity = SHA-256) → `register_source` →
  `ingest/pipeline.ts` decides what to process → pdf.js text → `ingest/extract.ts` (geometry,
  columns, headers) → `ingest/chunk.ts` → `embed_chunks` (Rust, ONNX) → `store_chunks`.
  Metadata: `ingest/identifiers.ts` (offline DOI/arXiv) → `ingest/resolve.ts` (doi.org,
  Crossref; **only with consent**) → `set_source_metadata`.
- **Writing.** TipTap in `editor/Editor.svelte`, with extensions in `editor/extensions`. Saved
  by `editor/autosave.ts` (no overlapping writes, flush on close). A citation is a node holding
  source ids. `stores/citationStore.ts` + `citations/document.ts` render **every** citation
  in the document together (disambiguation, ibid., note numbers). Output goes through
  `citations/sanitize.ts`.
- **Finding sources.** Selection → `search_sources` (Rust embeds the text, scores chunks) →
  `extensions/citation/Result.svelte`.
- **Reading.** `pdfreader/PdfReader.svelte` + `viewer.ts` (pdf.js) → marks in
  `stores/annotations.svelte.ts` → `save_annotation` + `embed_annotation`. The Notes panel
  searches them. `notes/draftContext.ts` carries the paragraph under the cursor to the panel.
- **Exporting.** PDF: `window.print()` with the print stylesheet. LaTeX: `export/latex.ts` +
  `export/bibtex.ts` → files → `compile_latex` if TeX exists.

## Rules that must not break

| Rule                                                                                  | Why / where                                 |
| ------------------------------------------------------------------------------------- | ------------------------------------------- |
| A source's id is its content hash (or `erti:<uuid>` without a file, from M1b)         | ADR 003; renames and duplicates collapse    |
| Shipped migrations are frozen and idempotent; a library backup precedes any migration | `schema.rs` header; ADR 008                 |
| Decisions live in pure TS modules; components orchestrate; vectors never cross IPC    | ADR 001                                     |
| Citation HTML is untrusted and goes through `sanitize.ts`                             | Manuscripts travel between people           |
| Manuscripts keep `type: "doc"` at the root                                            | ADR 002 amendment; older versions stay safe |
| Every network host is in the README list **and** CSP `connect-src`, behind consent    | `networkAllowlist.test.ts`                  |
| UI is built from `lib/ui` primitives and tokens; nothing new speaks unasked           | ADR 010; docs/ux.md                         |
| Every quality or speed claim comes from a committed, re-runnable measurement          | plan.md, testing.md                         |

## State

- **New state modules** use Svelte 5 runes in a `*.svelte.ts` file exporting one object, as in
  `stores/annotations.svelte.ts` and `stores/documents.svelte.ts`.
- **Existing `writable` stores** (`citationStore`, `outlineStore`, `draftContext`, …) stay until
  a change touches them. Don't mix both in one module.
- **Components** keep only local UI state. Anything two siblings share goes in a store, since
  the layout makes panels siblings.

## Recipes

Each recipe ends with what to test. Run `pnpm verify` before opening the PR (CLAUDE.md).

### Add a backend command

1. Write the SQL in `db/queries.rs` as a named function (no SQL in commands).
2. Add the command in `db_commands.rs` (or `commands.rs` for non-database work) with both
   `#[tauri::command]` and `#[specta::specta]`, returning `Result<T, AppError>`. Run CPU work in
   `spawn_blocking`. **A path from the webview goes through `scope::authorise` first** (M1a-3):
   put the body in a `*_in(&DbState, …)` function the command calls, so tests can reach it.
3. Give the error its kind where it's known: `?` on `state.library()` and friends (already a
   `Conflict` when nothing is open), `.or_database()` on the query layer's string errors,
   `.or_model()` on inference, and `AppError::from_io` for files. `Classify` won't compile on an
   error that already has a kind, so a kind can't be overwritten by accident.
4. Any type crossing IPC derives `specta::Type`. A 64-bit field needs
   `#[specta(type = specta_typescript::Number)]`, which says it fits in a JS number; prefer
   `u32` for parameters. `Option` fields in inputs get `#[specta(optional)]`.
5. Register it in `ipc_builder()` in `lib.rs`, then run `pnpm ipc:bindings`. The typed
   `commands.yourCommand(…)` appears in `src/lib/ipc/bindings.ts`.
6. Call it from TS as `call(commands.yourCommand(…))`, or `run(…)` when it returns nothing, and
   show failures with `describeError`. Importing `invoke` directly is an ESLint error.
7. Add it to the fake backend (M1a-1) so harness journeys can use it.

Test: a Rust integration test in `src-tauri/tests/` that goes **through the command**, not just
the query (see `tests/ipc_errors.rs` for why). CI fails if `bindings.ts` is stale.

### Change the database schema

1. Add a `Migration { to, sql, skip_if }` to `LIBRARY_MIGRATIONS` or `PROJECT_MIGRATIONS` in
   `db/schema.rs`, and bump `LIBRARY_VERSION`/`PROJECT_VERSION`.
2. Make it idempotent: `IF NOT EXISTS`, or `skip_if` for `ALTER TABLE ADD COLUMN`. Never edit a
   shipped migration; add another.
3. Add its fingerprint to `expected` in `tests/schema_migrations.rs`
   (`shipped_migrations_are_frozen`).

Test: upgrade from the previous version built by the real migrations; run twice (idempotent);
backup taken first (after M1a-5).

### Add a setting

**Until M1a-11:** read and write through `load('settings-store.json')` with a string key, give
it a default at the read site, and add the control to the right Settings tab. **After M1a-11:**
add the key, type and default to the settings schema in one place, and read it through the
typed settings module.

Test: the default applies on a fresh store; the value persists across a reload of the store.

### Add a rail panel

1. Add the name to `PanelNames` in `src/types/page.ts`.
2. Add an `IconButton` to `side-panel/Panel.svelte` (label required).
3. Render it in `routes/+page.svelte`'s panel switch, inside a `Panel` (M1c).

Test: a component test for its states (empty, failed, content), and a harness journey that
opens it.

### Add a UI element

Use a primitive from `lib/ui` ([design-system.md](design-system.md)). If none fits, add the
primitive there with a catalogue entry and a component test, then use it. Tokens only: no
numbers or colours in classes.

### Reach a new network host

Stop: this needs the maintainer (CLAUDE.md). When agreed, the host goes into the README's list,
CSP `connect-src` in `tauri.conf.json`, and `ALLOWED_HOSTS` in `networkAllowlist.test.ts`, all
in the same PR. The request goes through the consent gate.

### Add a pure module (parser, formatter, rule)

Put it in the `lib/` folder of its domain, with no Tauri, Svelte or `$lib` alias imports
(ADR 001), and a `*.test.ts` beside it. Hostile fixtures if it reads files from other people.

### Look at the UI or the real app

See "Seeing the app" in [CLAUDE.md](../CLAUDE.md): the fake-backend harness in a browser,
and probe builds for the real webview.

## Known rough edges

Tracked in the plan, and listed here so nobody trips over them:

- `utils/pdf_handlers.ts` is untested orchestration outside `lib/`. It moves into
  `lib/ingest` when M1b-7 touches it.
- `Editor.svelte` (750 lines) and `PdfReader.svelte` (1,869) mix decisions with orchestration.
  Extract when touched (M1a-7 does the manuscript part).
- Settings keys are scattered over 11 files until M1a-11.
- There's no log file or global error handler until M1a-12. Errors reach `console.*` (76 calls).
