# Erti 1.0 — Release Plan

The working plan from here to a releasable 1.0. [plan.md](plan.md) is the record of how the
foundations were hardened; this file is the route from there to a release, and it is kept current as
work lands — a milestone is ticked when its _Verify_ passes, not when its code merges.

---

## 0. Where we actually are (audited 2026-09-24)

|                    |                                                                      |
| ------------------ | -------------------------------------------------------------------- |
| Version            | 0.2.5 (`package.json`, `tauri.conf.json`, `Cargo.toml`)              |
| Frontend tests     | **995 pass**, 2 skipped, 66 files                                    |
| Rust tests         | **47 pass** (26 unit, 21 integration)                                |
| `svelte-check`     | 0 errors, 0 warnings, 1,216 files                                    |
| Branch             | `phase-7/document-structure`, 12 commits ahead of `main` (after M0)  |
| Uncommitted        | Committed in M0 (5 commits, 2026-09-24); see below                   |
| Open GitHub issues | 16, of which at least 4 are already done (§2)                        |
| Release pipeline   | Windows-only matrix, paused; no updater, no signing, no notarisation |

### What the audit found uncommitted — now committed

About 15,000 lines sat in the working tree, last touched 2026-09-06. M0 committed them as
`04f0fca`…`33a7c30`, each commit type-checked on its own:

- **Reading & annotation** — highlights, underlines, area snapshots, page notes; eight renamable
  labels (Claim, Evidence, Method, Limitation, Definition, Counter-point, Interesting, My opinion);
  printed page labels (`p. 853`, not sheet 11); reading position per paper.
- **Notes panel** — every mark across every paper, searchable by text or meaning, project first then
  library. It **follows the writing**: with nothing typed, it shows the notes that bear on the
  paragraph under the cursor.
- **NoteNudge** — a quiet margin dot beside a paragraph you have unused notes about.
- **Import** of highlights already made in Zotero, Preview or Adobe, marked `imported`, undoable.
- **Export** of notes to Markdown and a re-importable JSON sidecar.
- **Show in PDF** — jump from a note or result to the exact place in the paper (#37).
- Schema migrations 3–5 (`annotations`, `annotation_images`, `annotation_embeddings`,
  `annotation_labels`, `reading_positions`, mark style, page label) and a migration freeze test.
- pdf.js assets copied from `pdfjs-dist` at build time instead of 376 vendored files.

So the notes feature is already about 60% of the way there. **What's missing is notes that aren't
attached to a PDF page**: a note about a paper as a whole, and any note on a source that has no PDF
at all.

---

## 1. What "1.0" means — release criteria

1.0 ships when every line here is true and was verified, not assumed:

1. **The core loop works on a real library** — 200+ PDFs including two-column journals, ingested
   with network lookups on and off, with no stuck or poisoned sources.
2. **Any source can be cited** — PDF, book, chapter, web page, or a paper read in print — and every
   source can carry notes.
3. **Nothing the user writes can be lost** — autosave (done), plus version history they can
   restore from.
4. **The writing companion is useful and quiet** — related notes and passages appear beside the
   paragraph being written, and never interrupt.
5. **Attribution check** exists as a review you run, not a monitor, and never produces a score.
6. **The document can leave Erti in the formats people need** — PDF, verified on every platform
   rather than assumed (today it is `window.print()`, and webview print differs per OS), LaTeX
   (done) and DOCX.
7. **A researcher can move in** — import from BibTeX/RIS/CSL-JSON, not only folders of PDFs.
8. **It installs on every platform we ship at no cost to the project.** There's no paid code
   signing, so each platform gets a tested, illustrated first-open guide, and a working in-app
   updater.
9. **Every privacy claim in the README is re-verified** against network traffic on the release
   build.
10. **AGPL obligations are met in-app** — About screen with source link, licence, third-party
    notices, model licence.

---

## 2. GitHub issues — triage

| #   | Title                                      | Verdict                                                                 |
| --- | ------------------------------------------ | ----------------------------------------------------------------------- |
| 58  | Create a split view                        | **Close** — shipped in `34381a5`                                        |
| 37  | Jump to exact location in PDF              | **Close after M0** — `showInPdf.ts` (uncommitted)                       |
| 8   | Tooltip on files icon                      | **Close** — `Panel.svelte` has `title`/`aria-label`                     |
| 4   | Scrollbar colours                          | **Close** — plan.md Phase 6 records it done                             |
| 48  | New PDF overwrites values of existing PDFs | **Re-test, likely close** — filename-keyed pipeline replaced by hashing |
| 49  | DOI placeholder on new source              | **Close as obsolete** — CSL-JSON NULL until resolved, `doi` column      |
| 39  | Logo                                       | **1.0** — M7, needed for icons and installer                            |
| 23  | File operations from explorer              | **1.0, reduced** — rename/delete/duplicate manuscripts only (M5)        |
| 103 | Font family and size in toolbar            | **1.0** — M5                                                            |
| 104 | Line numbers for peer review               | **1.x**                                                                 |
| 99  | Fold document bar into tab strip           | **1.x**                                                                 |
| 100 | Draggable split divider                    | **1.0** — small, and the split looks broken without it                  |
| 101 | Drag tabs between panes                    | **1.x**                                                                 |
| 102 | Footnotes at foot of page                  | **1.x** — needs a paged-media layer (plan.md: endnotes, named as such)  |
| 11  | Draggable editor blocks                    | **1.x**                                                                 |
| 17  | Semantic Scholar recommendations           | **1.x** — network; needs its own consent entry                          |

---

## 3. Design of the new work

### 3.1 Sources without a PDF

**The constraint.** A source's identity is the SHA-256 of its PDF bytes (`sources.sha256`), and that
id is also the citation id (`citationStore` keys on it). No file means no identity, so there's
currently no way to cite a book read in print.

**Design.**

- A source without a file gets id `erti:<uuid>` in the same column. Citations, overrides,
  `source_set` and rendering all key on this column and keep working unchanged.
- It has no `locations`, no `chunks`, and no `ingest_status` row. Nothing waits on ingest.
- Created from: manual entry (a type-aware form driven by the Zotero schema `MetadataEditor`
  already uses), a DOI or ISBN lookup (behind the existing consent gate), or an import (§3.4).
- **Attaching a PDF later is the hard part.** The file gets its own hash and chunks, but manuscripts
  on disk — including co-authors' copies — already cite `erti:<uuid>`. Re-keying them isn't
  possible. So add `source_aliases(alias TEXT PRIMARY KEY, sha256 TEXT)`: the file hash becomes an
  alias that resolves to the canonical id, and search results map through it. **Spike this first
  (M1.1)** — it decides whether the approach holds.

### 3.2 Notes per source

A new `source_notes` table in the **library** DB. Notes follow the paper across projects, for the
same reason annotations live there.

```sql
CREATE TABLE source_notes (
    id         TEXT PRIMARY KEY,          -- uuid, survives sidecar round-trips
    sha256     TEXT NOT NULL REFERENCES sources(sha256) ON DELETE CASCADE,
    body       TEXT NOT NULL,             -- the note, Markdown
    quote      TEXT,                      -- exact words transcribed from the source, if any
    page_label TEXT,                      -- "p. 42" as printed, for pinpoint citation
    label_id   TEXT,                      -- same labels as highlights
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- A separate table rather than a new `annotations.kind`, because `annotations.page` is `NOT NULL`
  and changing the `kind` CHECK means rebuilding the table that holds work that cannot be
  regenerated (schema.rs already argues this).
- `quote` + `page_label` are what make a print-book reader first class. "p. 42: '…'" is exactly
  what someone reading on paper writes down, and it's exactly what the citation (pinpoint) and the
  attribution check (verbatim source text) need.
- Embedded through the same path as annotations, so they appear in the Notes panel, the writing
  companion and the check with no special-casing.
- UI: a Notes tab on each source in the Sources panel, and a "New source + note" flow for a book
  that isn't in the library yet.

### 3.3 One engine, three surfaces

The writing companion, the note nudge and the attribution check all ask the same question —
_what in my notes and library is this passage close to?_ — at different thresholds. Build that
once.

```
paragraph (cursor leaves, or idle)          whole document (on request)
        │                                           │
        ▼                                           ▼
  embed 1 paragraph ─┐                    sentence walk with PM positions
                     ▼                              │
     in-memory index: normalised vectors            ▼
     ├─ highlights + page notes        shingle index (verbatim / near-verbatim)
     ├─ source notes (+ quotes)        ├─ quotes in notes & highlights  ← highest precision
     └─ library chunks                 ├─ library chunks
                     │                 └─ other manuscripts in the project (self-reuse)
                     ▼                              │
             WRITING COMPANION                      ▼
     related notes · related passages      ATTRIBUTION CHECK (report)
     margin nudge (notes only)             citation-aware · quote-aware · no score
```

**Why the engine needs work before any of this.** `search_similar` reads every row of `chunks` on
each call, and computes scalar single-threaded cosine that recomputes the query's norm for every
chunk. At 20 papers (5,601 chunks) that's fine. At 200 papers (~56,000 chunks, ~86 MB of BLOBs)
it's a noticeable delay per query, and it doesn't work at all for batch use. The fix is modest:

- Store vectors pre-normalised, so cosine becomes a dot product.
- Keep a matrix in memory in Rust, built on library open and updated on ingest/delete, instead of
  `SELECT … FROM chunks` per query.
- `rayon` across rows for batch queries.

That's enough for the companion (one paragraph at a time). The check leads with shingles, so its
cost doesn't depend on embeddings at all.

### 3.4 Moving in: import

- **BibTeX / RIS / CSL-JSON** files → sources without PDFs (§3.1). Where an entry names a file
  path (Zotero's BibTeX export does), attach it and ingest.
- `bibtex.ts` already exports; import is the missing direction.
- Dedup on DOI, then normalised title + year, so importing a library on top of an ingested folder
  doesn't double every paper.

### 3.5 Attribution check — 1.0 scope

The Phase 7 epic, rescoped from the review in this chat's history:

- **In scope:** verbatim and near-verbatim matching (shingles, document-frequency discount for
  stock phrasing) against note quotes, highlights, library chunks, and the project's other
  manuscripts. Citation-aware (same-source citation nearby) and quote-aware. Also detects
  **drifted quotations** (cited and quoted, but not the source's words) and **wrong-source
  citations**.
- **Presented as a review you run** from a Check panel and offered before export. Results open
  the source in the split view at the matched page, via `showInPdf`.
- **Fixes:** Quote and cite (with pinpoint page) · Cite only · Block quote · Show me the source ·
  Dismiss. Not "add quotation marks" on its own.
- **Dismissals** go in a project migration (`PROJECT_VERSION` 1→2 — the first real project
  upgrade, so it needs a test against a v1 database), keyed on normalised sentence text plus
  source id.
- **Hard rules:** no document-level score or percentage, ever. Never "no issues found" — say
  "142 sentences checked against 23 sources in your library". Don't run automatically on a
  document you didn't write.
- **Out of 1.0:** paraphrase detection (the semantic pass) and inline decorations while writing.
  Both wait until the report mode has measured the real false-positive rate.
- **Gate:** a labelled fixture set and harness, in the style of `eval_retrieval`, measured
  **before** the UI is built.

---

## 4. Milestones

Each milestone ends with its _Verify_. Tick items as they land.

### M0 — Land what exists _(days)_

- [x] Commit the uncommitted work in reviewable, logical commits: focus refactor `04f0fca`,
      library schema + Rust `e6a7eda`, reader + pdf assets `a8d9880`, result → PDF `b936188`,
      notes panel + nudge `33a7c30`. Every commit passes `svelte-check` in isolation
- [x] Remove the stale `plugins.sql.preload` from `tauri.conf.json`; the plugin is gone
- [ ] Merge `phase-7/document-structure` → `main` — PR
      [#106](https://github.com/erti-rde/tauri-editor/pull/106) open, awaiting review
- [x] Close #8, #4, #49 (closed 2026-09-24); #58 and #37 close when #106 merges
- [ ] Re-test #48 against the hash-keyed ingest
- [x] Rename the attribution epic out of "Phase 7". It's M4 in this plan and was never filed on
      GitHub
- [x] Recover the CSL style-index work from a stale worktree (plan.md D10). Ported onto `main`,
      index regenerated fresh (986 → 2,862 styles, IEEE/Nature/Science added, dead entries gone),
      weekly upstream check in CI — PR [#107](https://github.com/erti-rde/tauri-editor/pull/107)

_Verify:_ CI green on `main` with all four jobs. A fresh clone runs `pnpm tauri dev`, opens a
project, highlights a PDF, finds the highlight in the Notes panel, and sees it survive a restart.

### M1 — Sources & notes model

- [ ] **M1.1 Spike:** `erti:<uuid>` sources + `source_aliases`; prove that attaching a PDF to a
      cited no-file source keeps every existing citation rendering
- [ ] Library migration 6: `source_notes`, `source_aliases`
- [ ] Manual source entry — type-aware form, validated against citeproc rendering
- [ ] DOI / ISBN lookup for manual entry (consent-gated; README enumerates the new endpoint)
- [ ] Source notes UI in the Sources panel; "new source + note" flow
- [ ] Source notes in the Notes panel, search and Markdown/JSON export
- [ ] Import BibTeX / RIS / CSL-JSON with dedup; attach files named in the entry

_Verify:_ cite a print book with a pinpoint page in APA, Chicago notes and IEEE. Add its PDF
later; every existing citation still renders, and its passages now appear in search. Import a
500-entry Zotero BibTeX export over an ingested folder with no duplicate sources.

### M2 — Retrieval engine

- [ ] Pre-normalised vectors (a migration that re-normalises existing rows, or doing it at load)
- [ ] In-memory index in Rust with lifecycle tied to library open / ingest / delete
- [ ] One query API across highlights, page notes, source notes and chunks, with per-kind results
- [ ] Extend the eval harness with a note-matching set (paragraph → the note written about it)
- [ ] Performance budget recorded in-repo: single-paragraph query at 200 papers

_Verify:_ Recall@5 and MRR on the existing set don't regress. Query latency at 56k chunks is
measured and meets the budget. Memory cost of the index is measured and recorded.

### M3 — Writing companion

- [ ] Companion view: related notes **and** related passages for the paragraph at the cursor,
      refreshed when the cursor leaves a paragraph or on idle — never per keystroke
- [ ] One-click cite from a result, with pinpoint page from the note, highlight or chunk
- [ ] NoteNudge extended to source notes; still at most one dot per paragraph
- [ ] Settings: companion on/off, nudge on/off (the nudge setting exists)
- [ ] Empty and failure states say what happened ("no notes on this project's sources yet"), not a
      silent blank

_Verify:_ on a multi-thousand-word document, typing latency is unchanged with the companion open
(measured). The companion never takes focus, never animates in, never opens anything unasked.

### M4 — Attribution check (1.0 scope, §3.5)

- [ ] Fixture set + harness first; record precision/recall per category
- [ ] Sentence walk with ProseMirror positions
- [ ] Shingle index + document frequency in Rust (library chunks, note quotes, highlights, project
      manuscripts)
- [ ] Citation-aware and quote-aware classification; drifted quotes; wrong-source citations
- [ ] Check panel + "check before export" prompt; open the match in the split view
- [ ] Fix actions; dismissals (project migration 2)
- [ ] Naming and copy reviewed against the README consent language

_Verify:_ a planted document (verbatim-uncited, verbatim-cited-unquoted, drifted quote,
wrong-source, self-reuse, stock phrase, clean) returns the expected set. The harness shows the
precision the thresholds were chosen at.

### M5 — Writing essentials

- [ ] Version history: snapshot on a timer and before risky operations; browse and restore
- [ ] Find & replace in the manuscript
- [ ] Spellcheck — verify the webview actually spellchecks the editor on each platform; set it
      explicitly
- [ ] **PDF export verified per platform.** `window.print()` → Save as PDF on macOS
      (WKWebView), Windows (WebView2) and Linux (WebKitGTK, where webview print has historically
      been unreliable). Wherever it falls short, add a direct "Export PDF…" that writes a file
- [ ] **DOCX export**, with citations and bibliography as rendered text
- [ ] Font family & size in the toolbar (#103)
- [ ] Rename / duplicate / delete manuscripts from the explorer (#23, reduced)
- [ ] Draggable split divider (#100)
- [ ] Library location as a setting (schema.rs says "user-configurable"; `+page.svelte` hard-codes
      `~/Erti/library.db`)

_Verify:_ restore a manuscript from yesterday's snapshot. Round-trip a DOCX with citations, a
table, an image and a bibliography through Word and LibreOffice. Move the library and reopen.

### M6 — Scale & quality gates

- [ ] The plan.md §11 verification run, which is still outstanding: 200+ PDFs, two-column
      journals, network resolver on and off, the retry path
- [ ] Keyboard-only traversal of every surface, including the new ones
- [ ] Every palette on every screen, new surfaces included
- [ ] Network capture of the release build against the README's list of what leaves the machine
- [ ] Error log to a local file the user can open and attach to a bug report (nothing is sent)

_Verify:_ the numbers are written into this file, beside the criteria in §1.

### M7 — Release engineering

- [ ] Version 1.0.0 in `package.json`, `tauri.conf.json`, `Cargo.toml`; real `authors`
- [ ] Logo and icon set (#39); sensible default window size (currently 800×600)
- [ ] About screen: version, AGPL-3.0, source link, third-party notices, MiniLM licence
- [ ] `tauri-plugin-updater` with signed update manifests
- [ ] macOS: **ad-hoc** signing (`signingIdentity: "-"`). It's free, and Apple Silicon won't run
      a completely unsigned binary at all
- [ ] Windows: unsigned installer; apply to **SignPath Foundation**, which signs open-source
      projects for free. If they accept us, their signing replaces the SmartScreen step in the
      guide
- [ ] Linux: AppImage + deb (no signing needed)
- [ ] **First-open guide** per platform, with screenshots. macOS 15+: System Settings → Privacy &
      Security → Open Anyway, since the right-click → Open bypass no longer works there. Windows
      SmartScreen: More info → Run anyway. Linux AppImage: `chmod +x`. Linked from README, the
      landing page and the release notes. It also explains _why_ (a free project and the cost of
      certificates), in the README's voice
- [ ] Publish SHA-256 checksums with every release, so an unsigned download can still be verified
- [ ] Updater keypair (free, separate from OS signing) generated and stored as repo secrets
- [ ] Fix `release.yaml`: platform matrix, pnpm version, multi-line changelog (the current `echo`
      into `$GITHUB_OUTPUT` truncates to one line)
- [ ] README and landing page updated for 1.0; short user guide
- [ ] A 0.9 beta to a handful of researchers before the tag

_Verify:_ install the published artefacts on a clean machine per platform, open a real project, and
update from 0.9 to 1.0 through the in-app updater.

---

## 5. After 1.0

Paraphrase-level attribution and inline mode · real footnotes (#102) · line numbers (#104) ·
document bar in the tab strip (#99) · drag tabs between panes (#101) · draggable blocks (#11) ·
Semantic Scholar recommendations (#17) · the embedding model bake-off (plan.md §12) ·
collaboration.

---

## 6. Decisions

| Decision                          | Choice                                                                                                                                             | Why                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Uncommitted annotation/notes work | Commit in logical pieces on `phase-7/document-structure`, then merge                                                                               | It's a finished feature that passes the full suite, and it exists only in the working tree       |
| Platforms                         | macOS, Windows, Linux                                                                                                                              | No paid signing, so signing no longer decides which platforms ship                               |
| Code signing                      | **None paid.** macOS ad-hoc; Windows unsigned, with a free SignPath Foundation application; Linux unsigned. First-open guide + published checksums | No budget, and "always free" rules out a paid tier to fund certificates                          |
| Attribution check in 1.0          | Review mode, verbatim/near-verbatim, drifted quotes, wrong-source; no paraphrase, no inline                                                        | Highest precision for the effort; the FP rate gets measured before anything speaks while writing |
| Formats in 1.0                    | PDF (verified per platform), DOCX, BibTeX/RIS/CSL-JSON import, version history                                                                     | User requirement, 2026-09-24                                                                     |
