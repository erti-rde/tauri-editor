# Erti 1.0 — Test strategy

How 1.0 is shown to work. It builds on what exists: 1,010 vitest and 47 cargo tests on `main`, golden-file
export tests, the retrieval harness, and the metadata-health run on 20 real papers in CI.

## Where we are (measured 2026-09-24)

Frontend line coverage **71%** (statements 71%, branches 85%). The average hides where the gaps
are. The files carrying the most uncovered lines are the orchestration layer, which is exactly
where 1.0 work lands:

| File                                    | Covered | Uncovered lines | 1.0 work that goes through it                        |
| --------------------------------------- | ------- | --------------- | ---------------------------------------------------- |
| `editor/Editor.svelte`                  | 4.7%    | 365             | manuscript envelope (ADR 002), save, export, cite    |
| `metadata-explorer/adapterCslZotero.ts` | 0.4%    | 222             | manual source entry (M1b). plan.md's #67, still open |
| `utils/pdf_handlers.ts`                 | 7.9%    | 210             | attach file to source, import, ingest limits         |
| `pdfreader/viewer.ts`                   | 44.6%   | 165             | pdf.js hardening, upgrade                            |
| `routes/+page.svelte`                   | 0%      | 92              | first run, consent, library open, backups            |

And **nothing runs the real app**: no test crosses the IPC boundary with a real Rust backend,
opens a real webview, or observes the CSP. That's how the lookups the README promises could be
blocked in the app while every test passed (PR #109).

## Principles

1. **Spec first for every 1.0 feature.** Each milestone item gets numbered acceptance criteria
   in its PR description or `specs/<feature>.md`. Each criterion gets at least one test, which
   names it (`// AC-3`).
2. **Extract before adding.** When a 1.0 change goes through an untested orchestrator
   (`Editor.svelte`, `pdf_handlers.ts`), the decision it touches moves into a pure module with
   tests first, as `pipeline.ts` did for ingest. ADR 001.
3. **Measure, don't assert.** Quality claims (retrieval, attribution precision, latency,
   memory) come from harnesses whose results are committed and re-runnable.
4. **Hostile fixtures for every untrusted format** (docs/security.md, task 3).

## Layers

| Layer                    | Tool                                                                                                | Runs                          | Covers                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit — pure TS           | vitest (+ fast-check for properties)                                                                | every PR                      | formats, parsers, dedupe, resolvers, classifiers                                                                                                                                  |
| Unit — Rust              | cargo test                                                                                          | every PR                      | queries, migrations, index, shingles, path scoping                                                                                                                                |
| Component                | vitest + @testing-library/svelte                                                                    | every PR                      | panels, dialogs, menus                                                                                                                                                            |
| Design system (new)      | Catalogue route + harness screenshots; rendered-contrast check; ratchet guard (vitest)              | every PR                      | every primitive in every state, 7 palettes × 2 densities; no hand-styled controls creeping back (ADR 010)                                                                         |
| **App-in-browser**       | Playwright over `/harness`: the real `+page.svelte` on the typed in-memory fake (`src/lib/harness`) | every PR                      | full UI flows: project, manuscript, panels, settings, the reader. Fails on any console error or unhandled command. The same fake serves vitest through `useFakeBackend()` (M1a-1) |
| **Real app E2E** (new)   | WebdriverIO + `tauri-driver` on Linux (xvfb)                                                        | every PR to main, release     | a handful of journeys through the real Rust backend, real webview, real CSP                                                                                                       |
| Harnesses                | `eval_retrieval`, metadata-health, new: attribution, companion latency, scale                       | CI (corpus) + milestone gates | quality and performance numbers                                                                                                                                                   |
| Manual release checklist | a person, per platform                                                                              | each release                  | what automation can't reach: macOS webview, installers, first-open, updater                                                                                                       |

`tauri-driver` supports Linux and Windows; macOS has no WKWebView WebDriver. So the real-app
E2E runs on Linux in CI (optionally Windows later), and macOS is covered by the release
checklist.

**Real-app journeys (keep this list short, and each one long):**

1. Open the fixture project → 3 PDFs ingest → search a sentence → cite → the bibliography
   renders → export LaTeX → the `.tex` and `.bib` are on disk.
2. Highlight a passage → restart the app → the highlight and its note are still there → it
   appears in the Notes panel.
3. Create a no-file source with a source note (quote + page) → cite it with a pinpoint →
   attach a PDF → the citation is unchanged.
4. Type, wait for autosave, kill the process → reopen → nothing lost; history lists a snapshot.
5. The CSP in the real webview: a `fetch` to each allowed host raises **no**
   `securitypolicyviolation`, and a `fetch` to a host outside the list raises one. The event fires
   whether or not the network answers, so no proxy or live service is needed. This is the
   regression test for PR #109, observed where the bug lived.

## Per milestone

**M1a/M1b — harnesses, file format, sources, notes, aliases, import**

- `manuscript/format.ts`: format 0 → 1 upgrade; round-trip (property); refusal of an unknown
  format; **a format-1 file loaded through the 0.2.5 code path keeps every paragraph** (ADR 002
  amendment); hostile envelopes (script in CSL title, `__proto__` keys, 10⁶ sources, depth bombs).
- `canonical(id)` in Rust and TS against the **same fixture table** (one JSON file both suites
  read), so the two resolvers can't drift. Attach-then-cite and merge-then-cite for search,
  notes and rendering (ADR 003).
- `adapterCslZotero.ts` to ≥ 90% before manual entry builds on it (#67).
- Import: the BibTeX → CSL mapping over a corpus of real `.bib` files (Zotero Better BibTeX,
  Mendeley, JabRef, Google Scholar exports, committed as fixtures); a RIS equivalent; the
  dedupe rules as a table test; a 10k-entry import under a time budget.
- Rust path scoping: `../`, symlink escape, absolute paths outside the roots are refused.
- Migration 6 against v5 libraries **built from the real frozen migrations**
  (`schema_migrations.rs` pattern), plus a backup-before-migrate test (ADR 008).

**M2 — retrieval index**

- Index/DB consistency: after each write command (`store_chunks`, save/delete annotation, source
  note, alias change) the index returns exactly what a full rebuild would.
- The existing Recall@k / MRR must not regress. The new note-matching set joins the harness.
- The latency and memory budget (ADR 005) as a harness run on a synthetic 56k-row library,
  with results committed.

**M3 — writing companion**

- Queries fire on paragraph exit or idle, never per keystroke (fake timers + a spy).
- A typing-latency benchmark with the companion on vs off, in the app-in-browser layer (long
  document, scripted typing), and a recorded threshold.
- It never takes focus; its empty and failure states are distinct (component tests).

**M4 — attribution check**

- A labelled fixture set, **built before the UI**: verbatim-uncited, verbatim-cited-unquoted,
  quoted-and-cited exact, drifted quote, wrong-source citation, self-reuse across project
  manuscripts, stock phrase in ≥ 10 sources, clean paraphrase, PDF-artefact text (hyphenation,
  ligatures). The harness reports a confusion matrix per category, committed like
  `last-run.json`.
- Normalisation idempotence and extractor/manuscript agreement (property tests).
- The whole check on a 10k-word manuscript over a 56k-chunk corpus under its budget.
- **Mutation testing** (Stryker) on the classifier module: its thresholds decide what a
  researcher is told, so a surviving mutant is a real risk.

**M5 — history, DOCX, find & replace, file operations**

- Snapshot cadence and thinning as pure functions of timestamps (table tests); restore takes a
  snapshot first; renaming a document moves its history.
- DOCX golden files over unzipped `word/document.xml` and `word/footnotes.xml`, same style as the
  LaTeX goldens, for all five vendored CSL styles including a note style.
- A manual DOCX round-trip through Word and LibreOffice on the release checklist.
- Find & replace over marks, citation nodes (never replace inside one) and undo grouping.

**M6 — scale and quality gates**

- The 200+ PDF run from plan.md §11, scripted, with results committed: ingest time, failures by
  cause, metadata rate with lookups on and off, index build time, RSS.
- Real-app journeys 1–5 on the 200-PDF library.

## CI changes

- ~~Add the app-in-browser job (Playwright, Chromium) to `ci.yaml`.~~ Done in M1a-1 ("Browser
  journeys"), with a check that the harness stays out of the production build.
- ~~Add the real-app E2E job on `ubuntu-22.04` with `webkit2gtk-driver` + `tauri-driver` +
  xvfb.~~ Done in M1a-2: "Real app journeys (Linux)", specs in `e2e-app/specs`. Each spec gets a
  fresh `HOME`. `snapshot(name)` saves the window and everything the app said (console errors,
  toasts) to `e2e-app/results`, which CI keeps. Two WebKitGTK quirks are handled in
  `specs/app.mjs`: type with `type()`, since the driver drops repeated keys, and find text with
  a `tag*=text` selector, since a bare `*=text` means link text.
- Coverage summary on PRs (report only, no threshold gate). The goal is that the orchestration
  files above stop being dark, not a number.
- `pnpm audit --prod` / `cargo audit` (docs/security.md task 7).

## Release test matrix

Run by a person on the draft release, one column per build, every cell ticked before publish.

| Check                                                                 | macOS arm64 | macOS Intel | Windows 11 | Ubuntu 22.04 | Fedora (AppImage) |
| --------------------------------------------------------------------- | ----------- | ----------- | ---------- | ------------ | ----------------- |
| Download matches `SHA256SUMS.txt`                                     |             |             |            |              |                   |
| First open, following the first-open guide exactly                    |             |             |            |              |                   |
| Consent gate: decline → no network (proxy log); accept → lookups work |             |             |            |              |                   |
| Open a real project; ingest 20 PDFs incl. two-column                  |             |             |            |              |                   |
| Highlight, note, restart, still there                                 |             |             |            |              |                   |
| No-file source + pinpoint citation in APA and Chicago notes           |             |             |            |              |                   |
| Import a Zotero `.bib`                                                |             |             |            |              |                   |
| Writing companion shows related notes; typing stays smooth            |             |             |            |              |                   |
| Attribution check on the planted document                             |             |             |            |              |                   |
| Export PDF (print), LaTeX, DOCX; the DOCX opens in Word/LibreOffice   |             |             |            |              |                   |
| Restore a snapshot; library backup exists                             |             |             |            |              |                   |
| Update from the previous release through the updater                  |             |             |            |              |                   |
| Every palette, keyboard-only pass of new surfaces                     |             |             |            |              |                   |
