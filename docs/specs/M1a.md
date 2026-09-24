# M1a — Safety net and file format

The precondition for changing files and schemas safely, and the one format that can't change
after 1.0.

### M1a-1 App-in-browser test harness

Refs: TEST · Depends on: M1a-10

Spiked 2026-09-24: a route that installs `mockIPC` before dynamically importing `+page.svelte`
boots the real app on a fake backend. Seven commands reach the consent screen, about 25 reach a
project with the editor open. The spike's fake backend is the starting point.

- AC-1 A test-only route (excluded from production builds) boots `+page.svelte` over an
  in-memory fake backend with fixture data: a project, three sources, marks, and a manuscript.
- AC-2 The fake backend lives in one module with one handler per command, and **fails loudly
  on any command it doesn't implement**. The spike returned `null`, which hides gaps.
- AC-3 Playwright (Chromium) runs it in CI: open a project, open the manuscript, open each rail
  panel, open Settings, with no console errors.
- AC-4 The first journey asserts M0-3: with no stored style, the editor mounts.
- AC-5 Screenshots from the harness can be attached to PRs (`pnpm e2e:shots`).
- AC-6 The fake backend implements the generated command types (ADR 011), so a fake that
  disagrees with Rust fails to type-check.
- AC-7 The same fake backend works in vitest (via `mockIPC` in jsdom) through one helper,
  replacing per-file mocks of `@tauri-apps/api/core` and `plugin-store` as tests are touched
  (11 files mock the store by hand today).

Verify: the CI job, and a screenshot of the editor from the harness.

### M1a-2 Real-app E2E on Linux

Refs: TEST · Depends on: —

- AC-1 WebdriverIO + `tauri-driver` + `webkit2gtk-driver` under xvfb on `ubuntu-22.04` runs
  the built app against a fixture project with 3 small PDFs.
- AC-2 Journey 1 (ingest → search → cite → bibliography → LaTeX export on disk) and journey 2
  (highlight → restart → still there → in the Notes panel) pass.
- AC-3 Journey 5: a `fetch` to each allowlisted host raises no `securitypolicyviolation`, and
  one to example.com does.
- AC-4 The job runs on PRs to `main`. A failure uploads screenshots and the app log.

Verify: the CI job's run link in the PR.

### M1a-3 Scope the Rust path commands

Refs: SEC-1 · Depends on: —

- AC-1 `read_pdf_file`, `hash_file`, `read_directory` and `source_for_path` canonicalise the
  path and accept it only if it lies under the open project root, the library directory, or a
  location recorded in `locations`.
- AC-2 Paths the user picks through the file dialog are allowed for the session.
- AC-3 Refused: `..` escapes, symlinks pointing outside the roots, absolute paths elsewhere,
  and on Windows UNC and drive-relative forms. Each has a Rust test.
- AC-4 The error says what happened: "Erti can only open files inside the project folder or
  your library".

Verify: `cargo test` names; an in-app probe reading `~/.ssh/config` is refused.

### M1a-4 Narrow the fs permissions

Refs: SEC-2 · Depends on: —

- AC-1 `fs:write-all` is replaced by the specific write commands the app uses. `remove` is not
  granted to the webview.
- AC-2 Deleting anything (manuscripts in M5, snapshots) goes through a Rust command that moves
  the file to the OS trash, and only within the project root.
- AC-3 An in-app probe records that writes and removes outside the project are refused, and
  writes inside it work.

Verify: the probe output in the PR; the capability file diff.

### M1a-5 Library backups

Refs: ADR-8 · Depends on: —

- AC-1 On library open, if the newest backup is more than 24 h old, `VACUUM INTO
<library dir>/backups/library-<UTC date>.db`, off the UI thread.
- AC-2 Before any library migration runs, a backup is taken unconditionally. A migration test
  asserts the file exists before the first statement runs.
- AC-3 Retention: 7 daily and 4 weekly. Older ones are deleted. Table test over dates.
- AC-4 A backup opens as a valid library at the same schema version.
- AC-5 A failed backup is logged and shown once as a toast. It never blocks opening the
  library.

Verify: `cargo test`; the backup directory after a harness run.

### M1a-6 Tests for `adapterCslZotero.ts`

Refs: TEST, #67 · Depends on: —

- AC-1 ≥ 90% line coverage.
- AC-2 A round trip CSL → Zotero form → CSL holds for every item type the Zotero schema maps,
  table-driven from `schema.json`.
- AC-3 Names (literal and split), dates (partial and full) and multi-value fields each have
  cases.

Verify: the coverage report line for the file.

### M1a-7 Extract manuscript load and save

Refs: ADR-1 · Depends on: —

- AC-1 `src/lib/manuscript/io.ts` owns reading, parsing, writing and the read-failed guard,
  with no Svelte imports. `Editor.svelte` calls it.
- AC-2 Existing behaviour is preserved: an unparseable file is never overwritten, autosave
  semantics are unchanged, and `magnum_opus.json` still opens.
- AC-3 ≥ 90% coverage of the new module.

Verify: coverage; the autosave race tests unchanged and passing.

### M1a-8 Manuscript format 1

Refs: ADR-2 (amended), UX-12 · Depends on: M1a-7

- AC-1 Files are written as `{ "type": "doc", "content": […], "erti": { "format": 1,
"sources": {…}, "savedWith": "x.y.z" } }`.
- AC-2 `erti.sources` holds a validated CSL-JSON snapshot of every cited source, rebuilt on
  each save.
- AC-3 A file with no `erti` key reads as format 0, and nothing is lost.
- AC-4 A file with `erti.format` above the build's is opened **read-only** with a banner ("This
  document was saved by a newer Erti") and is never autosaved.
- AC-5 **Cross-version:** a format-1 fixture loaded through the 0.2.5 code path
  (`createNodeFromContent` with the 0.2.5 schema) keeps every paragraph.
- AC-6 A citation whose source isn't in the local library renders from `erti.sources` with a
  dotted underline and the "From the manuscript: not in your library · Add to library" tooltip
  (UX-12). **Add to library** creates a no-file source from the snapshot.
- AC-7 A snapshot is taken before the first format-1 write of a format-0 file. Until M5 ships
  history, that's a copy `<name>.erti.json.format0.bak` beside the file.
- AC-8 Hostile envelopes (script in a CSL title, `__proto__` keys, 10⁶ sources, deep nesting)
  are rejected or sanitised by the shape guard (M1b-9 shares it).

Verify: the tests for each AC; a harness screenshot of an "away" citation.

### M1a-9 `-no-shell-escape`

Refs: SEC-11 · Depends on: —

- AC-1 `latexmk` and `pdflatex` are invoked with `-no-shell-escape`. Tectonic needs no flag;
  the reason is recorded in a comment.
- AC-2 A Rust test asserts the argument lists.

### M1a-10 One typed contract with Rust

Refs: ADR-11 · Depends on: —

- AC-1 **Spike first:** three commands (one query, one write, one with a file path) generated
  through tauri-specta, exact-pinned. If it doesn't work cleanly with Tauri 2.11, stop and raise
  it (CLAUDE.md).
- AC-2 All commands annotated; all IPC types derive `specta::Type`; `src/lib/ipc/bindings.ts`
  is generated.
- AC-3 CI regenerates the bindings and fails on any diff.
- AC-4 ESLint forbids `invoke` from `@tauri-apps/api/core` outside `src/lib/ipc`. All five
  files that call it directly are migrated.
- AC-5 Commands return `Result<T, AppError>` with a `kind`. At least the file, database and
  model paths map to specific kinds, with a Rust test per mapping.
- AC-6 One UI place (a helper used by toasts and banners) turns `AppError` into words by
  `kind`. Nothing parses error strings.
- AC-7 docs/architecture.md's "Add a backend command" recipe is updated.

Verify: the generated diff check in CI; a deliberately renamed Rust field fails `pnpm check`
(shown once in the PR).

### M1a-11 Typed settings

Depends on: —

- AC-1 One module (`src/lib/settings/`) declares every setting: key, type, default, and where
  it lives (the global store or the project database). The current keys include `cslXml`,
  `selectedStyle`, `selectedLocale`, `localeXml`, `wordCount`, `allowNetworkLookups`,
  `recentProjects`, appearance, page setup, the nudge and `libraryPath`.
- AC-2 Reads return the typed value or its default. Writes are type-checked. A renamed key has a
  migration entry.
- AC-3 ESLint forbids loading `settings-store.json` outside the module. All 11 files are
  migrated.
- AC-4 Tests: defaults on an empty store; persistence across a reload; a migration of one
  renamed key.
- AC-5 docs/architecture.md's "Add a setting" recipe is updated.

### M1a-12 Logging and global error handling

Refs: UX-10 · Depends on: M1a-11 · Replaces M6-6

- AC-1 `tauri-plugin-log` writes one rotating log file (Rust and webview) in the app's log
  directory. Nothing is sent anywhere.
- AC-2 `src/lib/log.ts` is the only logger. ESLint `no-console` is an error outside it, and all
  76 `console.*` calls are migrated.
- AC-3 Global `unhandledrejection` and `error` handlers log the error and show one toast: "Something
  went wrong: {message}. Details are in the log." Repeats are collapsed.
- AC-4 The log never contains manuscript text, note bodies or quotes: a test logs through each
  helper with such content and asserts it's absent.
- AC-5 Settings has **Open log folder**, which moves into About when M7a-10 lands.

**M1a Verify:** E2E journeys 1, 2 and 5 green in CI; a migration takes a backup first; the
path-escape tests pass; a format-1 file survives the 0.2.5 loader.
