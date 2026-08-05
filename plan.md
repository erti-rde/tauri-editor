# Erti — Foundation Hardening + Writing Features

## Context

Erti (`citation-machine` repo, remote `soft-rde/tauri-editor`) is a local-first, offline,
deliberately anti-GenAI research writing app for academics — AGPL-3.0, always free. It is much
further along than its 28 open issues suggest: the whole core loop already works end to end.

**What works today (v0.2.5):** open a folder → `read_directory` (Rust) → file tree → auto-scan
PDFs → pdf.js text extraction → `llm-chunk` sentence chunking → embeddings from a **local**
all-MiniLM-L6-v2 via ONNX Runtime → SQLite → Crossref/DOI metadata → TipTap editor with autosave
→ select text → semantic search over chunks → insert a citation rendered by citeproc-js in the
user's chosen CSL style. Plus a Zotero-schema-driven metadata editor and a pdf.js reader.

**What prompted this plan:** exploring the code and issues, then _measuring_ against the real dev
database, surfaced foundations that are broken, fake, or silently losing data — most not in the
issue tracker. Two measured numbers set the priority:

|                                                    |                     |
| -------------------------------------------------- | ------------------- |
| PDFs with usable citation metadata                 | **4 of 46 — 9 %**   |
| PDFs registered but never processed, never retried | **19 of 46 — 41 %** |

(First measured as 3 of 44 and 18 of 44; the dev database grew by two files during the work.
Re-measured figures are used throughout.)

Every feature the project wants next (bibliography, footnotes, journal formatting) consumes
author/title/year. At a 9 % metadata success rate none of them can work. **Ingest correctness is
the gate on everything else** — and, separately, the text being embedded is corrupted before
chunking even starts (§5.1).

**Intended outcome:** an app whose existing feature set is trustworthy at research scale (hundreds
of papers, not a demo folder), with the academic writing loop completed — correct citations, a real
bibliography, footnotes, multiple documents per project, working export — and every quality claim
backed by a measurement rather than an impression.

## Decisions taken

| Decision              | Choice                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direction             | Harden foundations **and** complete writing features in parallel — for the features that matter they are the same work (§3)                                 |
| Data model (#60)      | **Hybrid**: content-addressed central library + per-project folders, with **project-scoped search** that expands into the wider library (§4)                |
| Extraction & chunking | **Full geometry + structure aware** — reading order, column detection, header/footer stripping, section labels, references excluded, page tracking (§5)     |
| Embedding model       | **Measure, then decide.** Bake-off across five candidates under 2 GB RAM, scored on Erti's own labelled pairs, throughput measured alongside quality (§5.3) |
| Metadata resolution   | **All four**: offline DOI/arXiv scan → improved Crossref → manual entry → consent gate on all network calls (§6)                                            |
| Journal formatting    | **CSL-only this phase.** No journal-profile abstraction yet; correctness first                                                                              |
| Export                | WYSIWYG PDF via webview print (first-class, for Word-origin users) **+** LaTeX bundle, compiled locally when TeX is detected (§7)                           |
| Testing               | Golden-file export tests **and** a retrieval eval harness, both built in Phase 0, before the rewrites they guard (§8)                                       |
| UI/UX                 | **Full shadcn-svelte adoption, deferred to Phase 6** so visual churn doesn't collide with the data-layer and citation-engine rewrites (§10)                 |
| Release platforms     | **Paused** at your request. Adds a `pull_request` CI job; does **not** touch `release.yaml` or its platform matrix                                          |

---

## 1. Critical defects found (mostly NOT in the issue tracker)

### D1 — The metadata pipeline effectively does not work (9 % success)

Measured on the dev DB (`~/Library/Application Support/com.erti.app/magnum_opus_test.db`):

| state of `source_metadata`          | files | share   |
| ----------------------------------- | ----- | ------- |
| has a usable title                  | **4** | **9 %** |
| stored as the literal string `'{}'` | 23    | 50 %    |
| no row at all                       | 19    | 41 %    |

Causes by impact: (1) Crossref is queried by the PDF's embedded title/author
([pdf_handlers.ts:98](src/utils/pdf_handlers.ts:98)), but `info.Title` in real academic PDFs is
routinely empty or junk (`"Microsoft Word - final_v3.doc"`), and the fallback dumps 1000 characters
of page-1 text into a query string — **while most published PDFs contain their own DOI in the page
text, never scanned for**; (2) `getPdfMetadata` returns `{}` on any exception
([pdf_handlers.ts:159](src/utils/pdf_handlers.ts:159)) → persisted as `'{}'`;
(3) `processSinglePdf` inserts only `if (pdfMetadata)`, so a successful lookup with no match writes
no row; (4) no Crossref `mailto` polite-pool header, no rate limiting, retry or backoff; (5) no
manual DOI entry anywhere in the UI (**#49**).

### D2 — 41 % of ingested files are permanently poisoned, with no retry path

Measured: **19 of 46 files have a `files` row, zero chunks, zero metadata.**
[createFileBatch](src/utils/pdf_handlers.ts:198) inserts _all_ discovered PDFs into `files` up
front, then processes each; when `processSinglePdf` throws, the `files` row survives. The next scan
dedups on `file_name` already being in `files`
([pdf_handlers.ts:250](src/utils/pdf_handlers.ts:250)) — so **a file that fails once is never
retried, silently, forever.** Very likely a large part of **#48**.

### D3 — citeproc is driven statelessly, so citations are academically wrong

[citationStore.ts:79-86](src/lib/stores/citationStore.ts:79):

```js
const citation = { citationItems: ids.map((id) => ({ id })), properties: { noteIndex: 0 } };
const result = state.engine.processCitationCluster(citation, [], []);
```

Every citation is processed in isolation with empty `citationsPre`/`citationsPost` and a hardcoded
`noteIndex: 0`. citeproc-js requires the full ordered citation list. Consequences: **no
disambiguation** (two different Smith 2020 papers both render `(Smith, 2020)`; CSL cannot emit
`2020a`/`2020b` without sibling context); **no `ibid.` or short-form subsequent notes**; **note-based
styles are broken** (Chicago notes-bibliography and Turabian, the humanities standard, need real
monotonic `noteIndex`); and **`makeBibliography()` is called without ever calling `updateItems()`**
([citationStore.ts:117](src/lib/stores/citationStore.ts:117)), so a bibliography cannot reflect
"the works actually cited here".

[citeproc.d.ts](src/types/citeproc.d.ts) already declares `rebuildProcessorState`,
`appendCitationCluster` and `restoreProcessorState` — the right API was known but never wired up.
**Blocks #32 and #26.**

### D4 — PDF export is dead code

[commands.rs:95](src-tauri/src/commands.rs:95) `print_pdf_file` renders
`<project>/magnum_opus.html` via headless Chrome. **Nothing ever writes that file** — grep for
`writeTextFile`/`getHTML` finds only the `magnum_opus.json` write at
[Editor.svelte:94](src/lib/editor/Editor.svelte:94). Export has never worked. It also requires a
Chrome install (wrong for an offline-first app) and
`LaunchOptions::default_builder().build().unwrap()` panics without one.

### D5 — One global database shared by every project

`sqlite:magnum_opus_test.db` is hardcoded in three places
([+page.svelte:42](src/routes/+page.svelte:42), [lib.rs:16](src-tauri/src/lib.rs:16),
`tauri.conf.json` `plugins.sql.preload`) and `files.file_name` is **globally `UNIQUE`**. Open
project B and you see project A's sources (neither `loadSources()` nor `citationStore` filters by
project); two projects each containing `paper.pdf` collide and the second is never processed. This
is **#60** and contributes to **#48**. Production config ships a DB named `..._test.db`.

### D6 — Embeddings stored as JSON text; similarity computed in JS on the main thread

Measured: `SELECT typeof(embedding) FROM chunks` returns **`text`** for all 1296 rows despite the
column being declared `BLOB` ([migrations.rs:22](src-tauri/src/db/migrations.rs:22)), because
[pdf_handlers.ts:53](src/utils/pdf_handlers.ts:53) inserts `JSON.stringify(...)`.
**4702 bytes** measured per embedding vs **1536** as f32 → **3.1× bloat**; embeddings are **96 %** of
stored payload; the DB file is 30.2 MB of which **23.9 MB is freelist** (79 % dead, never `VACUUM`ed).

| corpus                        | chunks | today (JSON) | as f32 BLOB |
| ----------------------------- | ------ | ------------ | ----------- |
| 50 PDFs                       | 7.5 k  | 34 MB        | 11 MB       |
| 200 PDFs (typical PhD corpus) | 30 k   | 134 MB       | 44 MB       |
| 500 PDFs                      | 75 k   | 336 MB       | 110 MB      |

[Result.svelte:50](src/lib/editor/extensions/citation/Result.svelte:50) then `SELECT`s _every_ chunk
per search, pulls it all across the Tauri IPC boundary, `JSON.parse`s each 384-float array, and runs
cosine in JS on the main thread. At today's 1296 chunks that's ~6 MB and unnoticeable. **It falls
over between roughly 20 and 50 PDFs** — just past demo scale, short of one literature review.

### D7 — Autosave drops keystrokes

[Editor.svelte:81-101](src/lib/editor/Editor.svelte:81): `onUpdate` clears the debounce timer, then
`if (isSaving) return;` — edits arriving during a write cancel the pending save _and_ schedule
nothing. Silent data loss, worsened by a single hardcoded filename.

### D8 — Privacy promise vs. actual behaviour

The README states data "never leave your computer without your explicit consent", then admits
"currently we are not asking any consent". Ingest silently sends PDF titles and up to 1000
characters of page text to Crossref; Settings fetches CSL styles from GitHub. A stated-vs-actual gap
in the project's own core value proposition.

### D9 — `container-title` was typed as an array, silently breaking bibliographies

[citationStore.ts](src/lib/stores/citationStore.ts) declared `'container-title'?: string[]`, but
CSL-JSON specifies a plain string and that is what `doi.org` returns. Demonstrated with the golden
harness: given an array, citeproc **silently omits the journal name from every bibliography entry**,
and `makeBibliography()` **throws** (`value.match is not a function`) for some styles including IEEE.
The 3 real metadata rows in the dev DB store it correctly as text, so this was a wrong type
declaration rather than corrupt data — but it would mislead any code written against it (e.g.
`metadata['container-title'][0]`). Fixed in Phase 0, with a regression test.

### D10 — The bundled CSL style index is stale in both directions

`src-tauri/resources/csl/cslStyles.json` lists 986 styles. A random sample of 60 found **2 dead
links (~3%, so roughly 30 of 986)** — including `chicago-note-bibliography.csl`, renamed upstream to
`chicago-notes-bibliography.csl`, and `vancouver.csl`. Meanwhile `ieee.csl`, `nature.csl` and
`science.csl` exist upstream but are **absent from the index**. `Settings.svelte` fetches
`style.download_url` on selection and throws `Failed to fetch style: 404`; the error is caught and
logged, so the user just sees the style silently fail to apply. Tracked separately from this plan.

### D11 — Supporting gaps

|                                               |                                                                                                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **No CI at all** (#38)                        | No `pull_request` workflow exists. Lint/typecheck/tests never run automatically; Prettier violations are already committed.                                                                                              |
| **`test` script unusable in CI**              | `"test": "vitest"` is watch mode; needs `vitest run`. `coverage` configured but `@vitest/coverage-v8` not installed.                                                                                                     |
| **Core logic untested** (#63/#66/#67/#69/#71) | 47 tests cover 3 small stores + 6 leaf components. Zero for the 422-line `Citation.ts`, 331-line `adapterCslZotero.ts`, 308-line `pdf_handlers.ts`, all routes, all Rust. `Tree.test.ts` asserts nothing meaningful.     |
| **ONNX is single-threaded everywhere**        | [ml/mod.rs](src-tauri/src/ml/mod.rs) sets `with_intra_threads(1)` and requests `CUDAExecutionProvider`, absent on macOS (silent CPU fallback). Caps ingest throughput and constrains model choice (§5.3).                |
| **Version drift**                             | `package.json` 0.2.5 / `tauri.conf.json` 0.1.0 / `Cargo.toml` 0.1.0. `tauri-action` reads the Tauri one, so every release is labelled "Erti v0.1.0".                                                                     |
| **Phantom updater**                           | `@tauri-apps/plugin-updater` installed; no Rust crate, no registration, no config, no capability, zero imports. Shipped users can never update.                                                                          |
| **Dead scripts**                              | `dev:backend` and `build:fastapi` point at `src-backend/`, which doesn't exist (Python was removed → **#20 obsolete**).                                                                                                  |
| **Duplicate pdf.js** (#59)                    | `static/pdfjs` is 4.10.38 (viewer); `static/pdfjs-2` is a lone worker paired with npm `pdfjs-dist` 4.9.155 (extraction). ~19 MB shipped incl. a 5.3 MB `.map`, at mismatched versions.                                   |
| **Broad capabilities**                        | `sql:allow-execute` + `fs:write-all` + `fs:allow-home-read-recursive`, with `dbStore.executeQuery(arbitraryString)` reachable from all frontend code.                                                                    |
| **Stale artifacts**                           | `auto-imports.d.ts` (unused icon global; `unplugin-auto-import` isn't a dependency), empty untracked `.qodo/`, `eslint.config.ts` ignoring a nonexistent `eslint.config.js`, debug `Print PATH` steps in `release.yaml`. |

---

## 2. Issue triage

- **Close as obsolete:** #20 (Python API init — the Python backend was removed).
- **Resolved by this plan:** #60 (§4), #48 (D1+D2+D5), #59 + #38 (Phase 0), #49 (§6), #37 (§5 page
  tracking makes it possible), #32 + #26 (Phase 4), #57 + #29 + #45 + #14 (Phase 5),
  #4 + #6 + #7 + #8 + #39 (Phase 6), #63/#66/#67/#69/#71 (distributed).
- **Out of scope, unchanged:** #58 split view, #11 draggable blocks, #16/#17 Semantic Scholar,
  #23 explorer file commands.
- All 28 open issues have **empty bodies**. Worth writing real bodies for the ones being kept.

---

## 3. Why "harden" and "features" are one track

| Feature                          | The defect it depends on                                     |
| -------------------------------- | ------------------------------------------------------------ |
| Bibliography (#32)               | D3 — needs `updateItems()` + real cited-set state            |
| Footnotes (#26)                  | D3 — needs real `noteIndex` sequencing                       |
| Multiple files per project (#57) | D7 + the hardcoded `magnum_opus.json`                        |
| Page breaks (#45)                | D4 — needs the print stylesheet PDF export introduces        |
| PDF / LaTeX export               | D4 + D3 (a bibliography must be correct before exporting it) |
| Cite → exact PDF location (#37)  | §5 — chunks currently carry no page number                   |
| Cross-project source reuse       | D5 — the data model                                          |
| _Any_ citation feature at all    | **D1** — 93 % of sources have no author/title/year           |

Only **word count (#29)** is genuinely independent — and `Settings.svelte` already persists a
`wordCount` value with no consumer, so it is nearly free.

---

## 4. Target data model — hybrid library with project-scoped search

### Why hybrid

Measured, the three costs behave differently and only one is affected by this choice:

- **Disk is not a deciding factor.** Worst case for pure per-project (5 projects, 60 % overlap,
  200-paper corpus) is ~110 MB vs ~44 MB. Irrelevant on any modern machine.
- **Ingest CPU is the real duplication cost, paid at the worst moment** — while the researcher is
  trying to start writing. A global library pays it once, ever.
- **Search corpus size is a red herring** — D6 must be fixed regardless, and once cosine runs in
  Rust over f32 blobs, 30 k chunks is ~11 M multiply-adds.

So this is a UX decision, and the hybrid is the only option under which "cite the paper I read last
year for a different project" works at all.

### Layout

```
~/Erti/                          ← user-configurable, like Zotero's data directory
  library.db
    sources(sha256 PK, csl_json, zotero_type, doi, resolved_via, resolved_at)
    locations(sha256, path, last_seen)        ← same PDF may be seen in many folders
    chunks(sha256, idx, text, page_start, page_end, section,
           char_start, char_end, embedding BLOB)   ← f32, not JSON
    ingest_status(sha256, state, attempts, last_error, last_attempt)
    embedding_meta(model_id, dims, revision)  ← so a model swap can invalidate correctly

<project folder>/                ← portable, user-owned, shareable
  .erti/
    project.db
      documents(id, filename, title)
      source_set(sha256)                      ← which library sources this project uses
      metadata_overrides(sha256, csl_json)    ← project-local corrections
      settings(csl_style, csl_locale)
  chapter-1.erti.json
  chapter-2.erti.json
  sources/*.pdf
```

**PDFs are never copied into the library.** It stores content hashes plus the paths where each hash
has been seen (`locations`) — Zotero's "linked files" model. This respects "your files are yours",
avoids duplicating gigabytes, and keeps project folders self-describing. If a PDF is deleted the
citation still works; only "open PDF" degrades, with a last-known-location message.

**Content-addressing by SHA-256 of the PDF bytes** is what makes this work: it removes the
`file_name UNIQUE` collision behind #48, makes the same PDF in two folders one library entry
embedded once, survives renames and moves without orphaning metadata, and gives duplicate detection
for free.

`embedding_meta` exists because a model swap (§5.3) changes vector space entirely — mixing vectors
from two models silently produces garbage similarities. Recording the model per library makes
re-embedding a detectable, explicit migration.

### Project-scoped search — "prioritising the PDFs based on projects"

Search runs over both scopes and presents them separately, so the project is prioritised while the
rest of the corpus stays discoverable and one click away:

```
┌ Top matches in this project ──────────────────────────┐
│ ● Smith 2020  p.4 Results  "…the effect was strongest…"│
│ ● Jones 2019  p.2 Intro    "…consistent with earlier…" │
└───────────────────────────────────────────────────────┘
┌ Elsewhere in your library ────────────────────────────┐
│ ○ Patel 2021  p.7 Methods  "…a comparable mechanism…" │
│                                             [+ Cite]  │
└───────────────────────────────────────────────────────┘
```

`[+ Cite]` adds the `sha256` to `source_set` and inserts the citation in one action — no copying, no
re-embedding, because the chunks already exist. Page and section labels come from §5's chunk
metadata. The second section sits behind the same consent/settings toggle as everything else and can
be collapsed or switched off.

Two ways sources enter a project, both supported:

1. **Drop PDFs in the project folder** → scanned → registered in the library → auto-added to
   `source_set`. Today's UX, preserved exactly.
2. **Pick from the existing library** when starting or while writing → added to `source_set`, no
   copy, no re-embedding.

Hard grouping is proposed rather than a blended `similarity × project_boost` score, because grouping
is explainable and makes the add affordance obvious. A boost factor stays available later as a knob.

### Migration — **built, with one constraint discovered during implementation**

The plan assumed the migration could "hash every PDF still findable at its recorded path". **The old
schema has no path column** — `files` stored `file_name` and nothing else. So the migration cannot
locate those PDFs, cannot hash them, and cannot map old rows onto new sources by itself.

What it does instead: carry the resolved metadata forward keyed by filename into a
`legacy_metadata` table, and apply it when a file of that name is next ingested — ahead of the
network, so work that already succeeded is not redone and Crossref is not asked twice. Only rows
with a genuine title are imported; importing the `'{}'` placeholders would recreate the exact
problem they caused, metadata that looks resolved and is never retried.

Verified against a **copy** of the real database: 4 imported, 23 placeholders skipped, 19
never-processed skipped — 46 total, matching. The original is only ever opened read-only and stays
on disk.

---

## 5. Ingest pipeline: extraction, chunking, and the model

### 5.1 Extraction is currently corrupting the text

[pdf_handlers.ts:226](src/utils/pdf_handlers.ts:226) does `items.map(i => i.str).join('')` —
joining pdf.js text fragments with the **empty string**. Fragments frequently need a space between
them, so real output contains `"theobserved effect"`. `hasEOL` is ignored. **Embeddings are being
computed on mangled text**, degrading retrieval before chunking even starts. This is the
highest-leverage fix in the whole pipeline and nothing downstream can compensate for it.

### 5.2 Chunking design (full geometry + structure aware)

```
PDF
 └─ per page: pdf.js positioned text items (transform, width, height, hasEOL)
     ├─ reconstruct spacing and line breaks from geometry        (fixes 5.1)
     ├─ detect columns by x-clustering; emit in reading order    (most journals are 2-col)
     ├─ strip running headers/footers by cross-page repetition detection
     ├─ classify headings by font size/weight → section labels
     └─ detect the references/bibliography heading → cut everything after it
 └─ per section: sentence-split, then pack to a token target with 10–20 % overlap
 └─ each chunk records: text, page_start, page_end, section, char_start, char_end
```

Why each piece earns its place:

- **References exclusion** is a precision fix, not a nicety. Bibliography text is dense with author
  names, titles and years, so those chunks match _anything_ citation-shaped the user writes.
- **Page + offset tracking** is what unblocks **#37** (cite → jump to the exact location).
- **Section labels** let results say "p. 4, Results", which is materially more useful than a bare
  sentence, and give a future reranker a useful feature.
- **Overlap** matters because there is currently none — a match straddling a boundary is simply
  lost.
- **Token target instead of `minLength: 100` chars.** 100 chars ≈ 25 tokens against a 256-token
  model: roughly 10 % of capacity. Measured spread today is 7 to 505 chunks per file — wildly
  inconsistent. Target size is set by the chosen model's context window (§5.3).

Staying on pdf.js rather than GROBID: GROBID is purpose-built for exactly this and would do it
better, but needs a bundled JVM service — incompatible with offline and self-contained. Column
detection is the genuinely fiddly part; the eval harness (§8) is what tells us whether our
implementation is good enough.

### 5.3 Model bake-off — candidates under 2 GB RAM

Current baseline: **all-MiniLM-L6-v2**, 23M params, 384 dims, 2021-era, symmetric
sentence-similarity — and, as measured while building the harness, **already int8-quantised**
(`QUInt8`, IntegerOps per `ort_config.json`), so quantisation is not an available speed-up, it is
the starting point.

**Correction to an earlier assumption in this plan: the token ceiling is 128, not 256.** The
bundled `tokenizer.json` sets `truncation.max_length: 128` with `padding: Fixed(128)`. So chunks
are truncated at ~500 characters, and every chunk costs the same compute regardless of length.
This is a tighter constraint on §5.2's chunk sizing than assumed, and any chunking change that
produces larger chunks is silently truncated unless the tokenizer config changes too.

The other structural gap: the code embeds the user's sentence and the PDF passages with the same
model and **no prefixes**, while the BGE/E5/Qwen families are trained for asymmetric query→passage
retrieval and expect an instruction prefix — unexploited quality sitting on the table.

| candidate                     | params | dims (MRL) | context  | disk    | licence                      |
| ----------------------------- | ------ | ---------- | -------- | ------- | ---------------------------- |
| all-MiniLM-L6-v2 _(baseline)_ | 23 M   | 384        | 256      | 23 MB   | Apache-2.0                   |
| bge-small-en-v1.5             | 33 M   | 384        | 512      | ~33 MB  | MIT                          |
| nomic-embed-text-v1.5         | 137 M  | 768 → 256  | 8192     | ~274 MB | Apache-2.0                   |
| EmbeddingGemma-300M           | 300 M  | 768 → 128  | 2 K      | ~622 MB | **Gemma Terms — restricted** |
| Qwen3-Embedding-0.6B          | 596 M  | 1024 → 32  | **32 K** | ~639 MB | Apache-2.0                   |

All fit under 2 GB RAM at fp16, comfortably at int8. Notes that matter more than the MTEB column:

- **Throughput, not RAM, is the binding constraint.** Qwen3-0.6B is ~26× MiniLM's parameters. With
  ONNX currently pinned to `with_intra_threads(1)` (D9), a 200-paper corpus could go from minutes to
  hours. **Fix the threading first**, evaluate int8 quantisation as a first-class variable, and
  measure chunks/sec per candidate — a model that wins on quality and loses 20× on ingest time may
  still be the wrong choice.
- **Licence is a values question here, not just a legal one.** EmbeddingGemma benchmarks well — one
  comparison has it at 0.8706 nDCG@3 versus Qwen3-0.6B's 0.8168 at ~4× lower cost — but it ships
  under the Gemma Terms of Use with usage restrictions, not an OSI licence. For an AGPL-3.0 project
  that promises to be "always free" and reasons publicly about ML ethics, that's a deliberate
  decision to make rather than an incidental one. Qwen3 (Apache-2.0) and bge-small (MIT) are clean.
- **Matryoshka truncation keeps storage flat.** Qwen3 at native 1024 dims is 4 KB/chunk as f32 vs
  1.5 KB at 384 — 2.7× storage. Truncating to 384 or 256 preserves most quality at today's cost.
- **Qwen3 supports task instructions**, which fits Erti's query shape unusually well ("I am writing
  this sentence; find a passage that supports it"). Worth testing as its own variable.
- **SPECTER2** (AllenAI) is state of the art on citation recommendation — 38.4 MAP on MDCR — but it
  is a _document-level_ model (title+abstract → one vector), not a passage retriever. Wrong tool for
  chunk matching; the right tool for a future "papers you should cite" feature, adjacent to #17.
  Noted as complementary, explicitly not a replacement.

**Decision rule:** the model changes only if it wins on the harness in §8 at acceptable ingest
throughput. Prior expectation is that bge-small-en-v1.5 offers the best value (identical 384 dims →
zero schema change, 2× context, MIT), with Qwen3-0.6B the upside case if throughput allows.

---

## 6. Metadata resolution — all four resolvers

Ordered so the offline path runs first and the network is a fallback:

1. **Offline DOI / arXiv scan (new, biggest win).** Before any network call: check
   `pdfDoc.getMetadata()` for `info.doi` and XMP, then regex the first and last pages for
   `/10\.\d{4,9}\/[-._;()\/:a-z0-9]+/i` and `/arXiv:\s*(\d{4}\.\d{4,5})/i`. A hit yields one precise
   `doi.org` lookup instead of a fuzzy search.
2. **Improved Crossref (fallback only).** Add the `mailto` polite-pool parameter Crossref asks for,
   use `query.bibliographic`, add 429/backoff handling and retry, and **never persist `'{}'`** —
   record the failure in `ingest_status` so it can be retried.
3. **Manual DOI / metadata entry.** Every unresolved source gets `[Paste DOI…]` and `[Edit fields]`
   in the metadata explorer. `MetadataEditor.svelte`, `SourceSidebar.svelte` and
   `adapterCslZotero.ts` already provide the form machinery — mostly wiring. Surface a persistent
   "N sources need attention" affordance so failure is visible rather than silent.
4. **Consent gate.** First-run prompt plus a Settings toggle governing _all_ outbound requests
   (Crossref, doi.org, and the GitHub CSL-style downloads in `Settings.svelte`). With it off, Erti
   runs fully offline on DOI scan + manual entry. Closes D8.

Expected effect: metadata success from **9 %** to the high 80s–90s automatically, with a 2-second
manual fix for the remainder instead of a silent failure.

---

## 7. Export — two first-class paths

No journal-profile abstraction this phase. Style switching stays CSL style + locale in Settings; the
print stylesheet is written so a journal-profile layer can parameterise it later without rework.

### Path A — WYSIWYG PDF (default; for Word-origin researchers)

What's on screen is what comes out. The editor already renders an 816 px-wide white page (US Letter
at 96 dpi), so the model is right; it needs a matching print stylesheet.

- Serialize to styled HTML (`editor.getHTML()` + the editor's own CSS)
- Print via the **webview's own print** → the OS "Save as PDF" sheet
- **Delete the `headless_chrome` crate** (1.0.15, plus the `esaxx-rs` git patch that exists only to
  unblock the Windows linker) and remove `print_pdf_file`
- Zero new dependencies, fully offline
- Delivers **#45** (page breaks), which in turn is what makes the WYSIWYG promise honest — you must
  be able to _see_ where a page ends

### Path B — LaTeX bundle, compiled when TeX is present

- TipTap JSON → `main.tex` via a node walker; citation nodes → `\cite{key}`
- Library CSL-JSON → `references.bib`
- Emit `export/` with `main.tex`, `references.bib`, figures, and any journal-provided `.cls`/`.sty`
  the user supplies — Overleaf-ready, which is what most co-authors use
- Detect `latexmk` → `pdflatex` → `tectonic` on `PATH`; when found, enable **Compile to PDF** and
  surface TeX errors legibly. When absent, explain the bundle and point at Overleaf
- Delivers **#14**

---

## 8. Test strategy — built in Phase 0, before the rewrites it guards

Two harnesses. Both exist before Phase 4 touches citations and before Phase 2 touches the model.

### 8.1 Golden-file export tests — **built (Phase 0)**

Live at [engine.test.ts](src/lib/citations/engine.test.ts), driving
[engine.ts](src/lib/citations/engine.ts). Styles and the en-US locale are vendored under
`tests/fixtures/csl/` so the suite is hermetic — the app downloads styles at runtime, tests must
not. Covers APA, Chicago author-date, Chicago notes-bibliography, Harvard (Cite Them Right) and
IEEE. **Verified to have teeth:** replaying the current stateless approach against the same
fixtures renders both Smith 2020 papers as `(Smith, 2020)` and repeats the full Chicago note
instead of shortening it, so three of these assertions fail against today's `citationStore`.

These encode D3's acid tests as assertions rather than manual checks:

- two sources, same author, same year → `2020a` / `2020b`
- repeated citation in a note style → `Ibid.` or the correct short form
- note numbers ascend, and renumber correctly when paragraphs are reordered
- bibliography contains **exactly** the cited works, in style-correct order
- switching style re-renders every citation _and_ the bibliography

Then snapshot the export artifacts: `main.tex`, `references.bib`, and the print HTML. PDF bytes
aren't meaningfully diffable, so **the print HTML is the artifact under test** — with a visual
regression pass available later if it earns its keep.

### 8.2 Retrieval evaluation harness

A labelled set of ~25–30 (query sentence → correct source) pairs drawn from real papers, scored by
**Recall@5** and **MRR**, plus **chunks/sec ingest throughput** and peak RSS.

This is what makes §5 answerable instead of arguable. It is the only honest way to decide the model
question, and it also measures whether the chunking rewrite actually helped — run it as a matrix over
{model} × {chunk size} × {overlap} × {prefixes on/off} × {int8 vs fp16}. Results recorded in-repo so
future changes are compared against a baseline rather than an impression.

### 8.3 Unit coverage, distributed by phase

Prioritised by logic density and current absence: `adapterCslZotero.ts` (331 lines of pure data
mapping — the highest-value untested unit in the repo, **#67**), the new resolver chain and DOI/arXiv
regexes (**#69**), `citationStore` (**#63**), `Citation.ts` (**#66**), `PdfReader` (**#71**), plus
Rust unit tests for hashing, chunk packing and cosine. Also replace `Tree.test.ts`, which asserts
nothing meaningful.

---

## 9. Dependency currency

The project is roughly a year behind, with several majors available:

| package                               | in repo                         | latest                                  |                                                            |
| ------------------------------------- | ------------------------------- | --------------------------------------- | ---------------------------------------------------------- |
| **@tiptap/\*** (18 packages)          | 2.23.1                          | **3.29.0**                              | major                                                      |
| **pdfjs-dist**                        | 4.9.155                         | **6.1.200**                             | two majors                                                 |
| **vite**                              | 6.3.5                           | **8.1.5**                               | two majors                                                 |
| **typescript**                        | 5.8.3                           | **7.0.2**                               | two majors                                                 |
| **vitest**                            | 3.2.4                           | **4.1.10**                              | major                                                      |
| **eslint**                            | 9.30.0                          | **10.8.0**                              | major                                                      |
| svelte / @sveltejs/kit                | 5.34.9 / 2.22.2                 | 5.56.8 / 2.70.1                         | 22 / 48 minors                                             |
| tailwindcss / bits-ui / @tauri-apps/* | 4.1.11 / 2.8.10 / 2.6.x         | 4.3.3 / 2.18.1 / 2.11.x                 | minors                                                     |
| `citeproc`                            | 2.4.63                          | 2.4.63                                  | already current                                            |
| Rust `tokenizers` / `ndarray` / `ort` | 0.20.1 / 0.16.1 / `=2.0.0-rc.9` | 0.23.1 / 0.17.2 / rc.12 (no stable yet) | `tokenizers` since raised to 0.23.1 in Phase 0 — see below |

**Sequencing consequence:** TipTap v2→v3 changed the extension API. Phase 4 writes two new
extensions and heavily rewrites the 422-line `Citation.ts` — doing that on v2 and migrating later
means doing it twice, so **the TipTap 3 migration goes in Phase 0**. The pdf.js 4→6 upgrade belongs
with the extraction rewrite, where #59's consolidation already lands. Also retest whether the
`esaxx-rs` git patch is still needed on `tokenizers` 0.23 — it exists solely to unblock the Windows
MSVC linker and may now be removable.

---

## 10. Phases

### Phase 0 — Safety net & currency — **DONE**

Delivered on `phase-0/foundation-safety-net`. Gate status went from _2465 eslint errors, 37 type
errors, 46/47 tests_ to **all green**: eslint 0, prettier 0, svelte-check 0 errors, 61 vitest tests,
plus cargo fmt/clippy(-D warnings)/test which had never run at all.

Beyond the planned scope, the work surfaced and fixed: the `container-title` type bug (D9), a
Settings crash on malformed CSL resources, a `Dropdown` component whose `buttonText` type would have
thrown at runtime, the stale CSL index (D10, tracked separately), and — caught only by running the
app — a regression where adding the benchmark binary broke `pnpm tauri dev` because `cargo run` no
longer knew which binary to launch (fixed with `default-run`).

Everything after this rewrites the data layer, the ingest pipeline and the citation engine. The
harnesses and CI must exist first.

- `.github/workflows/ci.yaml` on `pull_request`: `pnpm lint`, `pnpm check`, `vitest run`,
  `cargo clippy -- -D warnings`, `cargo test`, `cargo build` check. **Do not touch `release.yaml`**
  or its platform matrix (paused).
- `"test": "vitest run"`, add `"test:watch"`, install `@vitest/coverage-v8`, add `test:coverage`.
- **Build the golden-file harness (§8.1) and the retrieval eval harness (§8.2)**, with the current
  model and chunker as the recorded baseline. Baseline numbers are the reference for every later
  claim.
- **Dependency upgrades.** Done: all in-range minors, **TipTap 2→3**, and the Rust Tauri crates
  realigned with npm. The TipTap migration was reordered ahead of the tooling majors because it is
  the one Phase 4 depends on; the rest are hygiene.

  **Deliberately deferred:** TypeScript 7, ESLint 10, Vite 8, Vitest 4, pdfjs-dist 4→6. Each is a
  toolchain-wide major with its own breakage surface, and TS 7 is the Go-based native compiler whose
  svelte-check and typescript-eslint support needs verifying first. Worth a separate focused pass —
  batching them with everything else would have made regressions hard to attribute.

- Fix `with_intra_threads(1)` and the macOS execution provider in [ml/mod.rs](src-tauri/src/ml/mod.rs).
- Sync versions to one source of truth (`package.json` 0.2.5 → `tauri.conf.json` + `Cargo.toml`).
- Add `.husky/pre-commit` with lint-staged (only `commit-msg` exists today).
- Consolidate pdf.js to one version (**#59**): drop `static/pdfjs-2`, align viewer and `pdfjs-dist`.
- Delete: `dev:backend` + `build:fastapi`, `@tauri-apps/plugin-updater` + `plugin-http` (unused),
  `auto-imports.d.ts`, `.qodo/`, the `Print PATH` debug steps; fix the `eslint.config.js`/`.ts`
  ignore mismatch. Close **#20**.

_Verify:_ open a PR with a deliberate lint error and a failing test; confirm CI red, then green.
`pnpm tauri dev` launches and the editor still works after the TipTap 3 migration — including
citation insertion, the bubble menu, tables and the toolbar. Both harnesses run and record a
baseline.

### Phase 1 — Data foundation — **DONE**

> **Architecture note recorded during implementation.** The database layer moved out of
> `tauri-plugin-sql` and into Rust with sqlx. That plugin registers migrations against a
> connection string fixed at build time, which cannot express `<project>/.erti/project.db` — the
> path isn't known until the user opens a folder. Owning the pools in Rust also made every
> statement a named function, so **`sql:default` and `sql:allow-execute` are now gone from the
> app's capabilities** rather than merely narrowed, and it puts cosine similarity in Rust ahead of
> Phase 3. The frontend `dbStore` is now a typed client over named commands with no SQL surface.

The schema is designed **once**, covering everything Phases 2–4 need, so the corpus is re-ingested
once rather than three times.

- New schema per §4: `library.db` + per-project `.erti/project.db`, including chunk page/section
  columns, `ingest_status`, and `embedding_meta`.
- Content-addressing by SHA-256 (new Rust command — hashing belongs next to the file read).
- Dynamic DB loading: remove `plugins.sql.preload` from `tauri.conf.json` and the hardcoded name
  from [+page.svelte:42](src/routes/+page.svelte:42) and [lib.rs:16](src-tauri/src/lib.rs:16); run
  migrations per database.
- Embeddings as f32 `BLOB`, not JSON text. `VACUUM` after migration.
- Library location setting (default `~/Erti/`), Zotero-style.
- One-time salvage + re-ingest migration (§4) with visible progress; old DB retained until confirmed.
- Narrow the SQL surface: replace `dbStore.executeQuery(arbitraryString)` with named queries so
  `sql:allow-execute` can be dropped from capabilities.

_Verify:_ two project folders each containing a PDF with the **same filename**, plus a third PDF
present in **both** — no collision, each project shows only its own sources, and the shared PDF has
exactly one `chunks` group for its hash. Migration runs on a copy of the real 44-file DB and the 3
genuinely-resolved metadata rows survive.

### Phase 2 — Ingest quality — **mostly done**

> **Measured.** Recall@1 80.0 % → **84.0 %**, MRR 0.900 → **0.920**, corpus embed 27.7 s → 20.8 s.
> Identifier scanning resolves **20 of 20** benchmark papers with no network call. Extraction and
> chunking live in `$lib/ingest` and the benchmark imports them directly, so it cannot drift from
> what ships.
>
> **Still open:** the embedding model bake-off (§5.3). The DOI path is unit-tested but has not been
> measured against real journal PDFs — the benchmark corpus is all arXiv.

- Fix extraction (§5.1) — spacing and line breaks from geometry, `hasEOL` honoured.
- Structure-aware chunking (§5.2): column detection and reading order, header/footer stripping,
  section labels, references excluded, token-target packing with 10–20 % overlap, page and offset
  recorded per chunk.
- Resolver chain (§6): offline DOI/arXiv scan → doi.org → improved Crossref → `ingest_status` on
  failure. **Never persist `'{}'`.**
- Fix D2: register a source as ingested only on success; `attempts`/`last_error`; a visible
  "N sources failed — Retry" affordance that actually re-attempts.
- Manual DOI / field entry wired to the existing `SourceSidebar` form.
- Consent gate + Settings toggle covering Crossref, doi.org and the GitHub CSL downloads (D8).
- **Run the model bake-off** (§5.3) on the harness; adopt a new model only if it wins at acceptable
  throughput, updating `embedding_meta` and re-embedding as an explicit migration.

_Files:_ [pdf_handlers.ts](src/utils/pdf_handlers.ts) (substantial rewrite, likely split into
extraction / chunking / resolution modules), [commands.rs](src-tauri/src/commands.rs),
[ml/mod.rs](src-tauri/src/ml/mod.rs), [MetadataEditor.svelte](src/lib/metadata-explorer/MetadataEditor.svelte),
[SourceSidebar.svelte](src/lib/metadata-explorer/SourceSidebar.svelte),
[Settings.svelte](src/lib/side-panel/settings/Settings.svelte).

_Verify:_ ingest ~20 real PDFs including two-column journal articles and ones with junk
`info.Title`. Re-run the metadata-health cross-tab used to find the 9 %: the large majority must
resolve, zero `'{}'` rows, every failure in `ingest_status` and visible in the UI, and Retry must
re-attempt. Spot-check extracted text for glued words. Confirm no chunk originates in a references
section. Eval harness must show Recall@5 and MRR **above the Phase 0 baseline** — if it doesn't, the
chunking work is not done.

### Phase 3 — Search

- **Move cosine similarity into Rust** over f32 blobs; only top-K crosses IPC. Replace the
  `SELECT`-everything in [Result.svelte:50](src/lib/editor/extensions/citation/Result.svelte:50).
- Scoped search UI per §4: "in this project" / "elsewhere in your library", each result showing page
  and section, with `[+ Cite]` adding to `source_set` and inserting in one action.

_Verify:_ time a search over a 200-PDF-equivalent corpus before and after, and record both numbers.
Confirm `[+ Cite]` adds without re-embedding. Confirm results display correct page numbers by
opening the cited PDF to that page.

### Phase 4 — Citation correctness → bibliography + footnotes

> **Partly done in Phase 0.** The correct citeproc driver now exists as a pure, tested unit at
> [engine.ts](src/lib/citations/engine.ts), with 14 golden tests in
> [engine.test.ts](src/lib/citations/engine.test.ts) proving disambiguation, note numbering, short
> forms, numeric renumbering and a cited-works-only bibliography across five styles. The risky
> correctness work is therefore already proven; Phase 4 is now integration, not discovery.

- Wire [citationStore.ts](src/lib/stores/citationStore.ts) onto `CitationEngine`: derive the ordered
  cluster list from the TipTap document and re-render on every change, rather than formatting each
  citation in isolation.
- Bibliography component (**#32**) — a document node re-rendering on style change and citation edit.
- Footnote extension (**#26**) — now possible because `noteIndex` is real.

_Verify:_ the golden-file suite from §8.1 must pass in full — this phase is defined by those
assertions rather than by manual inspection. Then confirm in the running app that switching CSL
style re-renders every citation and the bibliography.

### Phase 5 — Documents & export

- Multi-file projects (**#57**): drop the hardcoded `magnum_opus.json`; documents become user-named
  `*.erti.json` in the project folder, listed in the explorer beside PDFs.
- Fix the autosave race (**D7**): coalesce edits arriving during a write instead of dropping them.
- Word count (**#29**) — `Settings.svelte` already persists the setting; add the `StatusFooter`
  consumer.
- Print stylesheet + webview print → WYSIWYG PDF (**D4**); delete `headless_chrome` and
  `print_pdf_file`.
- Page breaks (**#45**) via `@page` rules, visible in the editor.
- LaTeX bundle export (**#14**) + compile when `latexmk`/`pdflatex`/`tectonic` is detected.

_Verify:_ type into a document while a save is in flight (throttle the disk or inject a delay) and
confirm **no keystroke is lost**. Two documents in one project, switching between them. Export a
document with citations, a table, an image and a bibliography to PDF and confirm it matches the
screen. Export the LaTeX bundle and compile it both with local TeX present and with `PATH` stripped,
confirming the graceful message. Export snapshots must match the golden files.

### Phase 6 — UI/UX with shadcn-svelte

Deferred to last so visual churn doesn't collide with the risky refactors. `shadcn-svelte` 1.4.2 is
built on **Bits UI** + Tailwind and installs by copying components into the repo via CLI rather than
as a dependency — and `bits-ui ^2.8.10` and Tailwind 4 are already dependencies, so the primitive
layer is in place. (Caveat: the available `Shadcn_UI` MCP server is shadcn/ui **v4 for React** —
useful for design and theme reference, not for Svelte code.)

- Establish the token system and **dark mode**, replacing the hardcoded hex colours scattered
  through components (`bg-[#FAFBFD]`, `border-[#C7C7C7]`, `bg-white` in
  [Editor.svelte](src/lib/editor/Editor.svelte)) and reconciling them with the 399-line
  `src/global.css` of CSS vars.
- Migrate hand-rolled primitives: `ui/Dropdown` → DropdownMenu, `ui/form/Select` → Select,
  `ui/form/DateField` → Calendar + DatePicker (already using `@internationalized/date`, which
  Bits UI uses too), `toast/Toast` → Sonner, `settings/Settings` → Dialog + Tabs,
  `MetadataEditor`'s hand-built 12-column grid → Data Table.
- Tooltip component and its two consumers (**#6**, **#7**, **#8**); scrollbar styling (**#4**).
- Real Landing / onboarding with recent projects, replacing the 30-line orange-button screen, plus
  the logo (**#39**).
- Fix the accessibility bugs this surfaces — e.g.
  [MetadataEditor.svelte:153](src/lib/metadata-explorer/MetadataEditor.svelte:153) puts `onclick` on
  a bare `<div>`: not keyboard-reachable, no role.

_Verify:_ keyboard-only traversal of every migrated surface. Both colour schemes on every screen.
Existing component tests updated rather than deleted.

---

## 11. Verification baseline

```bash
pnpm install && pnpm tauri dev
```

`node_modules` is currently absent, so a fresh install is needed.

The end-to-end loop that must never regress, checked after every phase: open a folder with several
PDFs → status footer reports progress → metadata explorer shows resolved titles and authors and
flags the rest → type in the editor → select a sentence → request a citation → matches are relevant,
project-scoped, and labelled with page and section → insert → change CSL style in Settings → every
citation and the bibliography re-render.

Repeatable health checks, kept in-repo:

```bash
sqlite3 "$LIBRARY_DB" "SELECT typeof(embedding), COUNT(*), AVG(LENGTH(embedding)) FROM chunks GROUP BY 1;"
```

Two numbers define success and both start from a measured baseline: **metadata resolution** must go
from 3/44 to the large majority with zero `'{}'` rows and every failure retryable, and
**Recall@5 / MRR** on the eval set must exceed the Phase 0 baseline.
