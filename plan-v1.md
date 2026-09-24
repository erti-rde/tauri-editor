# Erti 1.0 — Release Plan

The route from here to a releasable 1.0, kept current as work lands. **A box is ticked when its
_Verify_ passes, not when its code merges.** [plan.md](plan.md) is the record of how the
foundations were hardened; this file is what happens next.

| Document                             | Holds                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| **plan-v1.md** (this)                | Release criteria, milestones, sequencing, risks, decisions                                |
| [docs/adr/](docs/adr/README.md)      | The nine architecture decisions 1.0 rests on                                              |
| [docs/security.md](docs/security.md) | Threat model and the eleven 1.0 security tasks (`SEC-n`)                                  |
| [docs/testing.md](docs/testing.md)   | Test layers, per-milestone test plans, the release test matrix                            |
| [docs/release.md](docs/release.md)   | Release pipeline, free distribution, updater, versioning                                  |
| [docs/ux.md](docs/ux.md)             | Where each new surface lives and how it behaves (`UX-n`); [mockups](docs/ux/mockups.html) |
| [docs/specs/](docs/specs/README.md)  | Acceptance criteria for every item below, by ID                                           |
| [CLAUDE.md](CLAUDE.md)               | The working agreement for handing work off                                                |

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

- **Every network lookup is blocked inside the app.** The CSP has no `connect-src`, so it falls
  back to `default-src 'self'`. **Observed in the real app:** a probe built into Erti found every
  request to `doi.org`, Crossref and GitHub refused with a `connect-src` violation. The same
  build with #109's policy reached all of them and still refused `example.com`. The tests run in
  Node, where there is no CSP, so they never saw it.
- **Manuscripts have no file format** (bare editor JSON, no version) and **citations don't
  travel**: a co-author sees `[source removed]`. This must be fixed before 1.0 puts files in the
  wild (ADR 002).
- **Three Rust commands read any path with no scope at all**, and the webview can read all of
  `$HOME`, so one script injection could read the whole home folder (SEC-1). Writes are
  narrower than they look: the same probe was **refused** when writing or deleting in `$HOME`,
  because Tauri 2 scopes each fs permission separately (SEC-2, corrected).
- **The library has no backup**, though it now holds irreplaceable notes (ADR 008).
- **Nothing can remove a source** from the library (ADR 003).
- **A fresh install can't open the editor.** It waits for a citation style that can only be
  downloaded, and the CSP blocked the download. Nothing ships with the app (M0-3, P0).
- `citation-js` fails the offline gate (its core pulls in a network client), so BibTeX import
  uses the Better BibTeX parser instead (ADR 009).

---

## 1. What "1.0" means

1.0 ships when every line is true **and verified**:

1. **The core loop works on a real library, offline from the first launch.** 200+ PDFs
   including two-column journals, ingested with lookups on and off, with no stuck or poisoned
   sources. A fresh install can write and cite before any network call.
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

---

## 3. Milestones

Each item links to its spec: acceptance criteria, dependencies, and the evidence its PR must show.
**Tick an item when its PR has merged and its Verify holds.** GitHub issues carry the same IDs.

### M0 — Land what exists, fix first-run _(S)_ · [spec](docs/specs/M0.md)

- [x] Reading and notes work committed and merged (#106) · CSL index recovered (#107) · SQL
      plugin config dropped · #8, #4, #49, #58, #37 closed
- [ ] **M0-1** Merge the CodeRabbit follow-up (#108)
- [ ] **M0-2** Merge the CSP allowlist (#109). Verified in the real app
- [ ] **M0-3** A fresh install can write before any network call: bundled styles; editor
      mounts without one **(P0)**
- [ ] **M0-4** Remove `tauri-plugin-shell` (SEC-6)
- [ ] **M0-5** Re-test #48
- [ ] **M0-6** Clean up the stale worktree
- [ ] **M0-7** Merge the planning set (#110) and mirror it to GitHub

### M1a — Safety net and file format _(M, critical path)_ · [spec](docs/specs/M1a.md)

- [ ] **M1a-1** App-in-browser test harness (spiked: feasible)
- [ ] **M1a-2** Real-app E2E on Linux (journeys 1, 2, 5)
- [ ] **M1a-3** Scope the Rust path commands (SEC-1)
- [ ] **M1a-4** Narrow the fs permissions; deletes go to the trash (SEC-2)
- [ ] **M1a-5** Library backups, always before a migration (ADR-8)
- [ ] **M1a-6** Tests for `adapterCslZotero.ts` (#67)
- [ ] **M1a-7** Extract manuscript load and save (ADR-1)
- [ ] **M1a-8** Manuscript format 1, cross-version safe; citations from outside the library
      (ADR-2, UX-12)
- [ ] **M1a-9** `-no-shell-escape` (SEC-11)

### M1b — Sources, notes and import _(L, critical path)_ · [spec](docs/specs/M1b.md)

- [ ] **M1b-1** Spike: aliases hold (ADR-3)
- [ ] **M1b-2** Library migration 6
- [ ] **M1b-3** One canonical-id resolver
- [ ] **M1b-4** Remove a source (UX-4)
- [ ] **M1b-5** Add a source by hand (UX-2)
- [ ] **M1b-6** Add from a DOI; ISBN deferred
- [ ] **M1b-7** Attach a PDF to a source (UX-3 File tab)
- [ ] **M1b-8** Notes on a source (ADR-4, UX-3)
- [ ] **M1b-9** Import a bibliography, with preview (ADR-9, UX-6)
- [ ] **M1b-10** Shape guards and size limits (SEC-3, SEC-4)

### M2 — Retrieval index _(M)_ · [spec](docs/specs/M2.md)

- [ ] **M2-1** In-memory index (ADR-5)
- [ ] **M2-2** Index consistent with every writer
- [ ] **M2-3** Note-matching eval set
- [ ] **M2-4** Latency and memory budget measured

### M3 — Writing companion _(M)_ · [spec](docs/specs/M3.md)

- [ ] **M3-1** Notes and passages follow the paragraph (UX-5)
- [ ] **M3-2** One-click cite with a pinpoint
- [ ] **M3-3** Nudge covers source notes
- [ ] **M3-4** Settings: follow and nudge switches
- [ ] **M3-5** States that say what happened

### M4 — Attribution check _(L; moves to 1.1 if M1b overruns by half)_ · [spec](docs/specs/M4.md)

- [ ] **M4-1** Fixtures and harness, before any UI
- [ ] **M4-2** Sentence walk
- [ ] **M4-3** Shingle matching (ADR-6)
- [ ] **M4-4** Classification, mutation-tested
- [ ] **M4-5** Check panel (UX-7)
- [ ] **M4-6** Fixes
- [ ] **M4-7** Dismissals persist (project migration 2)
- [ ] **M4-8** Copy review

### M5 — Writing essentials _(L)_ · [spec](docs/specs/M5.md)

- [ ] **M5-1** Version history (ADR-7, UX-9)
- [ ] **M5-2** Find & replace (UX-11)
- [ ] **M5-3** Spellcheck, per platform
- [ ] **M5-4** PDF export, per platform
- [ ] **M5-5** DOCX export (ADR-9)
- [ ] **M5-6** Export menu (UX-8)
- [ ] **M5-7** Document menu: rename, duplicate, history, delete (#23)
- [ ] **M5-8** Font family and size in the toolbar (#103)
- [ ] **M5-9** Draggable split divider (#100)
- [ ] **M5-10** Settings › Library (UX-10)

### M6 — Scale and quality gates _(M)_ · [spec](docs/specs/M6.md)

- [ ] **M6-1** The 200-paper run, committed
- [ ] **M6-2** Input limits from measurements (SEC-4)
- [ ] **M6-3** pdf.js hardening and the upgrade decision (SEC-5)
- [ ] **M6-4** Network capture of the release build
- [ ] **M6-5** Accessibility and palettes on every new surface
- [ ] **M6-6** Local error log
- [ ] **M6-7** Threat model re-run (SEC-10)

### M7a — Release pipeline _(M, alongside M1a)_ · [spec](docs/specs/M7.md)

- [ ] **M7a-1** Rewrite `release.yaml` (ten defects)
- [ ] **M7a-2** Updater keys — _maintainer_
- [ ] **M7a-3** Updater behind consent (UX-1, SEC-8)
- [ ] **M7a-4** Dependency audit and SHA pinning (SEC-7)
- [ ] **M7a-5** SignPath Foundation application — _maintainer submits_
- [ ] **M7a-6** macOS self-signed identity — _maintainer creates the certificate_
- [ ] **M7a-7** Release script and changelog
- [ ] **M7a-8** First-open guide
- [ ] **M7a-9** Logo, icons, window size (#39)
- [ ] **M7a-10** About (UX-10)

### M7b — Beta to 1.0 _(M)_ · [spec](docs/specs/M7.md)

- [ ] **M7b-1** 0.9 beta — _maintainer recruits testers_
- [ ] **M7b-2** Triage every finding
- [ ] **M7b-3** Release matrix complete
- [ ] **M7b-4** 0.9 → 1.0 through the updater
- [ ] **M7b-5** README and user guide
- [ ] **M7b-6** Publish — _maintainer_

**Maintainer-only steps** (everything else can be handed off): M7a-2, M7a-5, M7a-6, M7b-1,
M7b-6, merging PRs, and the by-hand checks marked in specs (M0-2 AC-4, M5-3, M5-4, the
release matrix).

---

## 3½. Assumptions checked (2026-09-24)

What the plan rests on that was tested rather than assumed. Anything still open is listed with
where it will be settled.

| Assumption                                            | Result                                                                            | How                                                             |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Network lookups work in the app                       | **False on `main`**: every lookup blocked by CSP; fixed by #109                   | Probe built into the real app, old vs new policy                |
| A fresh install can write                             | **False**: the editor won't mount without a downloaded style → M0-3               | Real `+page.svelte` on a fake backend, with and without a style |
| The webview can delete in `$HOME`                     | **False**: writes and removes refused; the home scope is read-only                | Probe built into the real app                                   |
| The first envelope design is safe for older versions  | **False**: 0.2.5 would load it as invalid and autosave it empty → ADR 002 amended | Loaded through the installed TipTap                             |
| The app can boot in a browser for tests               | **True**: 7 IPC commands to the consent screen, ~25 to the editor                 | Spike route with `mockIPC`                                      |
| ONNX Runtime ships for Intel Mac                      | **True**: static 1.20.0 for all four targets, SHA-256 verified by the build       | `ort-sys` `dist.txt` and `build.rs`                             |
| BibTeX parser and docx are affordable                 | **True**: 109 KB and 102 KB gzip; load lazily                                     | Bundled with esbuild                                            |
| The BibTeX parser preserves titles                    | **False by default**: sentence-cases titles; must be switched off → M1b-9 AC-2    | Parsed a fixture                                                |
| Print-to-PDF works on Linux (WebKitGTK)               | Open → M5-4                                                                       | Needs Linux; by hand                                            |
| Self-signed macOS builds keep folder access on update | Open → M7a-6, in the beta                                                         | Needs two signed releases                                       |
| Updater avoids SmartScreen on Windows                 | Open → the beta                                                                   | Needs a Windows install                                         |

---

## 4. Risks

| Risk                                                           | Likelihood | Impact | Mitigation                                                                                                                                |
| -------------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Aliases prove insufficient (edge cases in merge/attach)        | Medium     | High   | Spike first in M1; fallback is the table rebuild ADR-3 rejected, costed before committing                                                 |
| A format change destroys manuscripts opened by an older Erti   | Was High   | High   | Found in review: the first envelope design did exactly that. Doc stays at the root (ADR 002 amendment), plus a cross-version load test    |
| The new format corrupts a manuscript on first save             | Low        | High   | Format-0 read path kept; snapshot before first format-1 write; round-trip property tests                                                  |
| In-app behaviour differs from tests again (the CSP, first-run) | High       | High   | Two found by probing the real app on 2026-09-24. Real-app E2E and the app-in-browser harness in M1a, before features build on assumptions |
| Unsigned installs put researchers off                          | High       | Medium | Tested first-open guide; checksums; SignPath application; the "why" explained honestly                                                    |
| Attribution check false positives erode trust                  | Medium     | High   | Fixture harness gates the UI; review mode only; no score; dismissals persist                                                              |
| The companion makes typing lag                                 | Medium     | Medium | Paragraph-exit/idle triggers; latency benchmark as a gate; off switch                                                                     |
| Updater private key lost                                       | Low        | High   | Stored in two places before the first signed release; rotation procedure written                                                          |
| Scope creep from open issues and new ideas                     | High       | Medium | §5 is the parking lot; anything new needs an explicit decision here to enter 1.0                                                          |
| One maintainer; knowledge in heads                             | Medium     | High   | ADRs, this plan, and the test docs are that knowledge written down                                                                        |

---

## 5. After 1.0

Paraphrase-level attribution and inline mode · real footnotes in the editor (#102) · line
numbers (#104) · document bar in the tab strip (#99) · drag tabs between panes (#101) ·
draggable blocks (#11) · Semantic Scholar recommendations (#17, needs its own consent entry) ·
the embedding model bake-off (plan.md §12) · a zip container for manuscripts with embedded
images · collaboration · macOS E2E once a WKWebView driver exists.

---

## 6. Decisions

| Decision                       | Choice                                                                                                                                                                 | Why                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Uncommitted reading/notes work | Committed in logical pieces and merged (#106)                                                                                                                          | A finished, tested feature that existed only in a working tree                                   |
| Platforms                      | macOS (arm64 + Intel), Windows, Linux                                                                                                                                  | Signing no longer gates platforms                                                                |
| Code signing                   | **None paid.** macOS self-signed stable identity (ad-hoc as fallback); Windows unsigned + SignPath Foundation application; Linux unsigned. Guide + checksums           | No budget; "always free". Self-signed over ad-hoc to keep macOS permissions across updates       |
| Attribution check in 1.0       | Review mode; verbatim and near-verbatim, drifted quotes, wrong-source; no paraphrase, no inline                                                                        | Highest precision for the effort; FP rate measured before anything speaks while writing          |
| Formats in 1.0                 | PDF (verified per platform), DOCX, BibTeX/RIS/CSL-JSON import, version history                                                                                         | User requirement, 2026-09-24                                                                     |
| Architecture                   | ADR 001–009                                                                                                                                                            | docs/adr/                                                                                        |
| BibTeX parser                  | `@retorquere/bibtex-parser`, not citation-js                                                                                                                           | citation-js's core depends on a network client (ADR 009)                                         |
| Network allowlist              | CSP `connect-src` = the README's list, pinned by a test                                                                                                                | The privacy promise enforced rather than stated (#109)                                           |
| Updater                        | Behind consent, like lookups                                                                                                                                           | It's a network call; the README promise covers it                                                |
| Library backups                | In M1a, not M5                                                                                                                                                         | M1b adds a library migration, and ADR 008 requires a backup before every migration               |
| Manuscript format shape        | Doc at the root + namespaced `erti` key (ADR 002 amendment)                                                                                                            | The first design made older versions overwrite the file with nothing                             |
| M1 split                       | M1a (safety net + format) / M1b (sources, notes, import)                                                                                                               | 17 items on one critical-path milestone; the part everything needs now finishes first            |
| ISBN lookup                    | Deferred to 1.x                                                                                                                                                        | It needs a new external service, and picking one is a privacy decision                           |
| Cut line                       | **Agreed:** M4 moves to 1.1 if M1b overruns by half                                                                                                                    | A single maintainer; better a decided cut than a drifting date (2026-09-24)                      |
| Who merges                     | **The maintainer merges every PR.** Claude opens PRs ready to merge, with each AC's evidence                                                                           | Maintainer's call, 2026-09-24                                                                    |
| Timeline                       | No date; work in plan order                                                                                                                                            | Maintainer's call, 2026-09-24                                                                    |
| Languages                      | English-only UI and English-only search model for 1.0, said in the README; UI strings kept per surface for later translation                                           | Maintainer's call, 2026-09-24; multilingual waits for the model bake-off                         |
| Tracking                       | GitHub milestone per plan milestone, one issue per spec ID; this plan stays the source of truth                                                                        | Maintainer's call, 2026-09-24                                                                    |
| Beta feedback                  | GitHub Issues, plus an email address in the beta notes                                                                                                                 | Default; the maintainer didn't pick one. Change anytime                                          |
| Bundled citation styles        | APA 7, Chicago (author-date, notes), Harvard CTR, IEEE, MLA 9, Vancouver; locales en-US, en-GB                                                                         | Offline-first; a fresh install couldn't write without them (M0-3)                                |
| Dependency upgrades            | Only what 1.0 needs: pdf.js decided in M6-3 (security, extraction). Other majors after 1.0 unless one blocks                                                           | Upgrades are churn with no user-facing gain before 1.0                                           |
| Compatibility promise          | 1.x reads every manuscript and library written by 0.2+ and 1.x. Library migrations forward-only, with a backup. A newer-format file opens read-only, never overwritten | What a co-author one version behind needs                                                        |
| Placement of new surfaces      | As docs/ux.md: Check as a rail panel; companion inside Notes; source notes in the Sources sidebar; Export as one menu; history takes over the workspace                | One place per job; the writing stays visible for reviews                                         |
| Import undo                    | No undo; the preview (UX-6) comes before anything is written                                                                                                           | A batch-undo needs import tracking in the schema; the preview prevents the mistakes it would fix |

---

## 7. How work is handed off

[CLAUDE.md](CLAUDE.md) is the working agreement every session reads. In short: take the first
unticked item whose dependencies have merged; tests first, named for the acceptance criteria;
run everything CI runs; attach the Verify evidence; open one PR per item, titled with its ID and
closing its issue. **The maintainer merges.** Stop and ask only for the cases CLAUDE.md lists:
a failed spike, a wrong AC, the maintainer's identity or secrets, a new network host,
permission or dependency, or scope creep.
