# Erti 1.0 — Release Plan

The route from here to a releasable 1.0, kept current as work lands. **A box is ticked when its
_Verify_ passes, not when its code merges.** [plan.md](plan.md) is the record of how the
foundations were hardened; this file is what happens next.

| Document                             | Holds                                                          |
| ------------------------------------ | -------------------------------------------------------------- |
| **plan-v1.md** (this)                | Release criteria, milestones, sequencing, risks, decisions     |
| [docs/adr/](docs/adr/README.md)      | The nine architecture decisions 1.0 rests on                   |
| [docs/security.md](docs/security.md) | Threat model and the ten 1.0 security tasks (`SEC-n`)          |
| [docs/testing.md](docs/testing.md)   | Test layers, per-milestone test plans, the release test matrix |
| [docs/release.md](docs/release.md)   | Release pipeline, free distribution, updater, versioning       |

---

## 0. Where we are (2026-09-24)

|                  |                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Version          | 0.2.5                                                                                    |
| `main`           | Document structure, reading & annotation, notes panel, CSL index refresh — all merged    |
| Tests            | 1,010 vitest on `main` (1,014 with #109), 47 cargo; `svelte-check` and lint clean        |
| Coverage         | 71% lines. The orchestration layer is dark: `Editor.svelte` 4.7%, `pdf_handlers.ts` 7.9% |
| End-to-end       | **Nothing runs the real app** (docs/testing.md)                                          |
| Open PRs         | #108 (CodeRabbit follow-up for #107), #109 (CSP `connect-src` allowlist)                 |
| Open issues      | 11: #104 #103 #102 #101 #100 #99 #48 #39 #23 #17 #11                                     |
| Release pipeline | Ten defects; can't ship 1.0 as-is (docs/release.md)                                      |

**What the planning pass found**, beyond the first draft of this plan:

- **Network lookups are very likely blocked inside the app.** The CSP has no `connect-src`, so
  it falls back to `default-src 'self'`, and Tauri's docs say the policy is injected in dev as
  well as release. A page carrying the identical policy was refused by `doi.org`, Crossref and
  GitHub, while the same page without it reached all three. The tests run in Node, where there
  is no CSP. **Not yet observed in the app itself.** #109 fixes it with an enforced allowlist,
  and its checklist is that observation.
- **Manuscripts have no file format** (bare editor JSON, no version) and **citations don't
  travel**: a co-author sees `[source removed]`. This must be fixed before 1.0 puts files in the
  wild (ADR 002).
- **The webview can read all of `$HOME` and delete within it**, and three Rust commands read any
  path with no scope at all. One script injection away from the whole disk (SEC-1, SEC-2).
- **The library has no backup**, though it now holds irreplaceable notes (ADR 008).
- **Nothing can remove a source** from the library (ADR 003).
- `citation-js` fails the offline gate (its core pulls in a network client), so BibTeX import
  uses the Better BibTeX parser instead (ADR 009).

---

## 1. What "1.0" means

1.0 ships when every line is true **and verified**:

1. **The core loop works on a real library.** 200+ PDFs including two-column journals, ingested
   with lookups on and off, with no stuck or poisoned sources.
2. **Any work can be cited, and every source can carry notes.** PDF, book, chapter, web page, a
   paper read in print; pinpoint pages from notes and highlights.
3. **Manuscripts are a versioned format that carries its sources.** A co-author without your
   PDFs sees every citation.
4. **Nothing the user writes or marks can be lost.** Autosave, manuscript version history, and
   rotating library backups.
5. **The writing companion is useful and quiet.** Related notes and passages beside the
   paragraph, never interrupting, with no measurable typing lag.
6. **The attribution check is a review you run,** measured against a labelled fixture set, never
   producing a score.
7. **A researcher can move in and out.** Import BibTeX/RIS/CSL-JSON; export PDF (verified per
   platform), LaTeX and DOCX.
8. **What leaves the machine is exactly what the README lists,** enforced by the CSP in the
   webview, inventoried in Rust, and confirmed by a network capture of the release build.
9. **The security baseline holds.** SEC-1 to SEC-6 and SEC-11 are done; the threat model is re-run on the
   finished surface.
10. **It installs on macOS, Windows and Linux at no cost to the project,** with a tested
    first-open guide, checksums, and a signed in-app updater behind consent.
11. **AGPL obligations are met in-app.** About screen, source link, licences, third-party
    notices, model licence.
12. **A 0.9 beta has been used by researchers** other than the maintainers, and what they hit is
    fixed or deliberately deferred.

---

## 2. Sequencing

```
M0 land what exists ──▶ M1a safety net + format ──▶ M1b sources, notes, import ──┬──▶ M2 index ──▶ M3 companion ──┐
                                 │                                                ├──▶ M4 attribution check ───────┤
                                 └──────────────────────────────────────────────▶ M5 writing essentials ─────────┤
M7a release pipeline (independent — start alongside M1a) ─────────────────────────────────────────────────────────┤
                                                                                                        ▼
                                                                      M6 scale & quality gates ──▶ M7b 0.9 beta ──▶ 1.0
```

- **M1a → M1b is the critical path.** Everything after it reads the manuscript format,
  resolves canonical ids, or needs the E2E harness. It was one milestone of 17 items; it's split
  so that the part everything depends on (harnesses, security boundary, backups, file format)
  finishes first and can ship on its own. M5 needs only M1a.
- **M4 doesn't wait for M2.** The attribution check is shingle-based (ADR 006), independent of
  the vector index.
- **M7a (pipeline) is infrastructure** with no dependency on features. Building it early means
  the 0.9 beta isn't blocked on CI work at the end.

| Milestone                    | Size | Depends on |
| ---------------------------- | ---- | ---------- |
| M0 Land what exists          | S    | —          |
| M1a Safety net + file format | M    | M0         |
| M1b Sources, notes, import   | L    | M1a        |
| M2 Retrieval index           | M    | M1b        |
| M3 Writing companion         | M    | M2         |
| M4 Attribution check         | L    | M1b        |
| M5 Writing essentials        | L    | M1a        |
| M6 Scale & quality gates     | M    | M2–M5      |
| M7a Release pipeline         | M    | —          |
| M7b Beta → 1.0               | M    | M6, M7a    |

Sizes are relative (S ≈ days, M ≈ 1–2 weeks, L ≈ 3+ weeks of focused work). Summed, that's
roughly **4–6 months of focused single-maintainer work**. Calendar dates wait until capacity is
known. **Proposed cut line (not yet agreed):** if M1b overruns by more than half its size, M4
(the largest feature, and the one no other criterion depends on) moves to 1.1 by an explicit
decision in §6, rather than by drift.

---

## 3. Milestones

Tags point at the source of each item: `ADR-n`, `SEC-n` (docs/security.md), `TEST`
(docs/testing.md), `REL` (docs/release.md).

### M0 — Land what exists _(S)_

- [x] Commit the ~15k lines of uncommitted reading/notes work in reviewable commits; merged to
      `main` via #106
- [x] Recover the CSL style-index work from a stale worktree (plan.md D10) — #107: 986 → 2,862
      styles, weekly upstream check
- [x] Drop the unused `tauri-plugin-sql` config
- [x] Close #8, #4, #49; #58 and #37 closed by #106
- [ ] Merge #108 (review follow-up for #107)
- [ ] Merge #109 (CSP allowlist) **and verify in the app:** a DOI resolves, an arXiv paper
      resolves, a new citation style downloads
- [ ] Remove `tauri-plugin-shell`; `opener` covers opening links — SEC-6
- [ ] Re-test #48 against hash-keyed ingest; close or reproduce
- [ ] Clean up the stale worktree `.claude/worktrees/distracted-chatelet-d0168b` and its branch
- [ ] Commit this planning set: `plan-v1.md`, `docs/adr/`, `docs/security.md`,
      `docs/testing.md`, `docs/release.md`

_Verify:_ CI green on `main`. In `pnpm tauri dev`: highlight a PDF, find it in the Notes panel,
restart, still there; with lookups on, a new PDF resolves its metadata.

### M1a — Safety net and file format _(M, critical path)_

Everything here is either a precondition for changing files and schemas safely, or the file
format itself, which is the one thing that can't be changed after 1.0 puts files in the wild.

- [ ] App-in-browser harness: Playwright + `mockIPC` with an in-memory fake backend; boots
      `+page.svelte` — TEST
- [ ] Real-app E2E: WebdriverIO + `tauri-driver` on Linux/xvfb in CI; journeys 1–2 — TEST
- [ ] Scope the Rust path commands to the project root and known locations — SEC-1
- [ ] Verify the effective fs scope, then narrow it (no `$HOME` write, no `remove`) — SEC-2
- [ ] Library backups with `VACUUM INTO`, **always before a migration** — ADR-8
- [ ] `adapterCslZotero.ts` tests to ≥ 90% before manual entry builds on it (#67) — TEST
- [ ] Extract manuscript load/save out of `Editor.svelte` into a tested module — ADR-1
- [ ] Manuscript format 1: the doc at the root plus a namespaced `erti` key with embedded CSL;
      format-0 read path; newer-format refusal; **a 1.0 file survives a 0.2.5 load** — ADR-2
- [ ] `compile_latex` passes `-no-shell-escape` explicitly — SEC-11

_Verify:_ E2E journeys 1–2 pass in CI; a migration takes a backup first; `../` and symlink
escapes are refused; a 1.0 manuscript opened by the 0.2.5 loader keeps every paragraph; a
manuscript sent to a clean library renders every citation from the embedded sources.

### M1b — Sources, notes and import _(L, critical path)_

- [ ] **Spike:** aliases hold (attach a PDF to a cited no-file source; every citation still
      renders; search reports the canonical id) — ADR-3
- [ ] Library migration 6: `source_aliases`, `source_notes`, `source_note_embeddings` — ADR-3,
      ADR-4
- [ ] `canonical(id)` in Rust and TS against one shared fixture table — ADR-3
- [ ] Remove a source (refuses while cited, unless confirmed) — ADR-3
- [ ] Manual source entry, type-aware — ADR-3
- [ ] DOI lookup for manual entry (doi.org is already allowed). **ISBN lookup deferred to 1.x:**
      it needs a new external service, and choosing one is a privacy decision, not a detail
- [ ] Source notes UI in the Sources panel; "new source + note" flow; in the Notes panel,
      search and sidecar export — ADR-4
- [ ] Import BibTeX (`@retorquere/bibtex-parser`) / RIS / CSL-JSON with dedupe; attach named
      files; measure bundle size — ADR-9
- [ ] Shape guards and size limits for envelope, CSL-JSON, sidecars and imports, with hostile
      fixtures — SEC-3, SEC-4

_Verify:_ cite a print book with a pinpoint in APA, Chicago notes and IEEE. Attach its PDF;
every citation still renders. Import a 500-entry Zotero `.bib` over an ingested folder with no
duplicates. E2E journey 3 passes in CI.

### M2 — Retrieval index _(M)_

- [ ] In-memory normalised index in Rust over chunks, annotations and source notes; one query
      API, one result type with `kind` — ADR-5
- [ ] Every write command keeps the index consistent, with a test per command — ADR-5
- [ ] Note-matching eval set added to the retrieval harness — TEST
- [ ] Latency and memory budget measured on a synthetic 56k-row library; int8 fallback only if
      the budget is broken — ADR-5

_Verify:_ Recall@k and MRR don't regress; a single-paragraph query at 56k rows is under 50 ms; the
index build is under 2 s; memory is recorded.

### M3 — Writing companion _(M)_

- [ ] Related notes **and** related passages for the paragraph at the cursor, refreshed on
      paragraph exit or idle, never per keystroke
- [ ] One-click cite with the pinpoint page from the note, highlight or chunk
- [ ] NoteNudge covers source notes; still at most one dot per paragraph
- [ ] Settings: companion on/off, nudge on/off
- [ ] Empty and failure states that say what happened

_Verify:_ typing-latency benchmark with companion on vs off within the recorded threshold; it
never takes focus or animates in.

### M4 — Attribution check _(L)_

- [ ] **Labelled fixture set and harness first,** with a confusion matrix committed — TEST
- [ ] Sentence walk with ProseMirror positions
- [ ] Manuscript-indexed, corpus-streamed shingle matching over chunks, highlights, note quotes
      and project manuscripts — ADR-6
- [ ] Classification: citation-aware (canonical ids), quote-aware, drifted quotes, wrong-source
      citations; mutation-tested — ADR-6, TEST
- [ ] Check panel + "check before export"; results open the source in the split view at the
      matched page
- [ ] Fixes: Quote and cite · Cite only · Block quote · Show me the source · Dismiss
- [ ] Dismissals: project migration 2, tested against a v1 project DB
- [ ] Copy reviewed against the README's voice. No score, ever; never "no issues found"

_Verify:_ the planted document returns the expected set; the harness shows the precision the
thresholds were chosen at; a 10k-word check over 56k chunks is within budget.

### M5 — Writing essentials _(L)_

- [ ] Version history as plain snapshot files; thinning; preview and restore — ADR-7
- [ ] Find & replace (never inside a citation node; one undo step)
- [ ] Spellcheck verified in each platform's webview and set explicitly
- [ ] **PDF export verified per platform;** a direct "Export PDF…" wherever print falls short
- [ ] **DOCX export** with real footnotes for note styles; goldens for all five vendored styles
      — ADR-9
- [ ] Font family and size in the toolbar (#103)
- [ ] Rename, duplicate and delete manuscripts, moving their history (#23, reduced)
- [ ] Draggable split divider (#100)
- [ ] Library location as a setting

_Verify:_ restore yesterday's snapshot; a DOCX with citations, a table, an image and a note-style
bibliography opens correctly in Word and LibreOffice; move the library and reopen.

### M6 — Scale and quality gates _(M)_

- [ ] The 200+ PDF run, scripted, with results committed: ingest time, failures by cause,
      metadata rate with lookups on and off, index build, RSS — TEST
- [ ] Input limits set from those measurements — SEC-4
- [ ] pdf.js: `isEvalSupported: false`; plan the pdfjs-dist upgrade — SEC-5
- [ ] Network capture of the release build against the README list — criterion 8
- [ ] Keyboard-only traversal and every palette on every new surface
- [ ] A local error log the user can open and attach to a report (nothing is sent)
- [ ] Re-run the threat model on the finished surface — SEC-10

_Verify:_ the numbers sit beside the criteria in §1; E2E journeys 1–5 pass on the 200-PDF
library.

### M7a — Release pipeline _(M, start alongside M1a)_

- [ ] Rewrite `release.yaml` to the design in docs/release.md, fixing all ten defects — REL
- [ ] Updater keypair generated offline, custody and rotation written down — SEC-9
- [ ] `tauri-plugin-updater` behind consent; README entry; Rust network inventory — SEC-8
- [ ] `pnpm audit` / `cargo audit` in CI; actions SHA-pinned in the release job — SEC-7
- [ ] Apply to SignPath Foundation for Windows signing
- [ ] macOS: sign with a **free self-signed certificate** (a stable identity kept as a CI secret)
      rather than ad-hoc. macOS ties privacy permissions such as Documents-folder access to the
      code signature, and an ad-hoc signature changes with every build, so each update would
      likely re-prompt for folder access. Gatekeeper still warns either way. **Verify in the 0.9
      beta:** update twice; does macOS keep folder access?
- [ ] `pnpm release X.Y.Z` script + `git-cliff` changelog
- [ ] First-open guide with screenshots per platform; checksum instructions
- [ ] Logo and icon set (#39); sensible default window size (currently 800×600)
- [ ] About screen: version, AGPL-3.0, source link, third-party notices, model licence

_Verify:_ a dry-run tag produces a draft release with all four builds, `SHA256SUMS.txt` and
`latest.json`; the smoke test catches a deliberately removed model file.

### M7b — Beta to 1.0 _(M)_

- [ ] 0.9.0 beta to a handful of researchers; collect what they hit
- [ ] Fix or deliberately defer every beta finding, recorded here
- [ ] Release test matrix complete on the 1.0 draft — TEST
- [ ] Update from 0.9 to 1.0 through the updater on every platform
- [ ] README, landing page and user guide updated for 1.0
- [ ] Publish

---

## 4. Risks

| Risk                                                         | Likelihood | Impact | Mitigation                                                                                                                             |
| ------------------------------------------------------------ | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Aliases prove insufficient (edge cases in merge/attach)      | Medium     | High   | Spike first in M1; fallback is the table rebuild ADR-3 rejected, costed before committing                                              |
| A format change destroys manuscripts opened by an older Erti | Was High   | High   | Found in review: the first envelope design did exactly that. Doc stays at the root (ADR 002 amendment), plus a cross-version load test |
| The new format corrupts a manuscript on first save           | Low        | High   | Format-0 read path kept; snapshot before first format-1 write; round-trip property tests                                               |
| In-app behaviour differs from tests again (like the CSP)     | High       | High   | Real-app E2E in M1, before features build on assumptions                                                                               |
| Unsigned installs put researchers off                        | High       | Medium | Tested first-open guide; checksums; SignPath application; the "why" explained honestly                                                 |
| Attribution check false positives erode trust                | Medium     | High   | Fixture harness gates the UI; review mode only; no score; dismissals persist                                                           |
| The companion makes typing lag                               | Medium     | Medium | Paragraph-exit/idle triggers; latency benchmark as a gate; off switch                                                                  |
| Updater private key lost                                     | Low        | High   | Stored in two places before the first signed release; rotation procedure written                                                       |
| Scope creep from open issues and new ideas                   | High       | Medium | §5 is the parking lot; anything new needs an explicit decision here to enter 1.0                                                       |
| One maintainer; knowledge in heads                           | Medium     | High   | ADRs, this plan, and the test docs are that knowledge written down                                                                     |

---

## 5. After 1.0

Paraphrase-level attribution and inline mode · real footnotes in the editor (#102) · line
numbers (#104) · document bar in the tab strip (#99) · drag tabs between panes (#101) ·
draggable blocks (#11) · Semantic Scholar recommendations (#17, needs its own consent entry) ·
the embedding model bake-off (plan.md §12) · a zip container for manuscripts with embedded
images · collaboration · macOS E2E once a WKWebView driver exists.

---

## 6. Decisions

| Decision                       | Choice                                                                                                                                                       | Why                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Uncommitted reading/notes work | Committed in logical pieces and merged (#106)                                                                                                                | A finished, tested feature that existed only in a working tree                             |
| Platforms                      | macOS (arm64 + Intel), Windows, Linux                                                                                                                        | Signing no longer gates platforms                                                          |
| Code signing                   | **None paid.** macOS self-signed stable identity (ad-hoc as fallback); Windows unsigned + SignPath Foundation application; Linux unsigned. Guide + checksums | No budget; "always free". Self-signed over ad-hoc to keep macOS permissions across updates |
| Attribution check in 1.0       | Review mode; verbatim and near-verbatim, drifted quotes, wrong-source; no paraphrase, no inline                                                              | Highest precision for the effort; FP rate measured before anything speaks while writing    |
| Formats in 1.0                 | PDF (verified per platform), DOCX, BibTeX/RIS/CSL-JSON import, version history                                                                               | User requirement, 2026-09-24                                                               |
| Architecture                   | ADR 001–009                                                                                                                                                  | docs/adr/                                                                                  |
| BibTeX parser                  | `@retorquere/bibtex-parser`, not citation-js                                                                                                                 | citation-js's core depends on a network client (ADR 009)                                   |
| Network allowlist              | CSP `connect-src` = the README's list, pinned by a test                                                                                                      | The privacy promise enforced rather than stated (#109)                                     |
| Updater                        | Behind consent, like lookups                                                                                                                                 | It's a network call; the README promise covers it                                          |
| Library backups                | In M1a, not M5                                                                                                                                               | M1b adds a library migration, and ADR 008 requires a backup before every migration         |
| Manuscript format shape        | Doc at the root + namespaced `erti` key (ADR 002 amendment)                                                                                                  | The first design made older versions overwrite the file with nothing                       |
| M1 split                       | M1a (safety net + format) / M1b (sources, notes, import)                                                                                                     | 17 items on one critical-path milestone; the part everything needs now finishes first      |
| ISBN lookup                    | Deferred to 1.x                                                                                                                                              | It needs a new external service, and picking one is a privacy decision                     |
| Cut line                       | **Proposed, needs your call:** M4 moves to 1.1 if M1b overruns by half                                                                                       | A single maintainer; better a decided cut than a drifting date                             |
