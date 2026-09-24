# ADR 009 — DOCX export and bibliography import as pure TS modules

**Status:** Accepted, 2026-09-24. Library choices from the evaluation below (registry data pulled
2026-09-24).

## Context

1.0 requires DOCX export (M5) and BibTeX/RIS/CSL-JSON import (M1). Both are format
transformations over data the frontend already holds in memory: ProseMirror JSON and rendered
citations for export, and text files in, CSL-JSON out, for import.

## Decision

- **DOCX:** `src/lib/export/docx.ts`, a pure function `(doc, renderedCitations, pageSetup) →
Uint8Array`, beside `latex.ts` and shaped like it. It's built on the `docx` npm package. The
  bytes are written by the existing fs plugin.
  - Citations and the bibliography are **rendered text**. Italics from citeproc's `<i>` become
    italic runs; citeproc's whole output surface is `div` and `i` (sanitize.ts).
  - **Note styles become real Word footnotes.** Word paginates, so DOCX gets true footnotes even
    though the editor has endnotes (#102 stays open for the editor itself).
  - Page setup (paper, margins, spacing, running heads) maps to section properties.
  - Golden-file tests over the unzipped `word/document.xml`, as the LaTeX export does.
- **Import:** `src/lib/import/` with one module per format, each `text → CslItem[]` plus a
  shared `dedupe(existing, incoming)` (DOI first, then normalised title + year + first author).
  Creating sources and attaching files go through Rust commands (ADR 003).
  - **BibTeX/BibLaTeX:** `@retorquere/bibtex-parser` (ISC), the parser behind Zotero's Better
    BibTeX. It handles the parts hand-rolled parsers get wrong (LaTeX → Unicode, `@string`,
    crossref, name lists), and Erti owns a small, tested field mapping to CSL-JSON.
  - **RIS:** a hand-written parser. RIS is line-oriented (`TAG  - value`), and the mapping to CSL
    is the whole job.
  - **CSL-JSON:** native; validated against the same shape guard the ADR 002 envelope uses.

## Evaluation

| Criterion (weight)              | `docx`             | docxtemplater               | html-docx-js                                         | html-to-docx    | Pandoc               |
| ------------------------------- | ------------------ | --------------------------- | ---------------------------------------------------- | --------------- | -------------------- |
| Licence, AGPL-compatible (gate) | MIT ✓              | MIT ✓                       | MIT ✓                                                | MIT ✓           | GPL ✓                |
| Offline, no network deps (gate) | ✓                  | ✓                           | ✓                                                    | ✗ `axios`       | ✓ (binary)           |
| Footnotes (30)                  | native ✓           | paid module                 | ✗                                                    | partial         | ✓                    |
| Fits PM JSON → document (25)    | programmatic API ✓ | needs a .docx template      | HTML via altChunk; LibreOffice/Docs render it poorly | HTML only       | external process     |
| Maintenance (20)                | 9.7.2, 2026-09-23  | 3.71.0, 2026-09-21          | 0.3.1, 2022                                          | 1.23.1, 2026-09 | active               |
| Footprint (15)                  | 6 deps (jszip)     | 1 dep                       | 3 deps                                               | 12 deps         | ~100 MB binary       |
| Testability (10)                | pure fn → bytes    | template + data             | pure                                                 | pure            | subprocess           |
| **Verdict**                     | **chosen**         | template model is wrong fit | stale, poor fidelity                                 | fails gate      | fails self-contained |

| Criterion (weight)              | `@retorquere/bibtex-parser`                        | citation-js plugins                      | astrocite        | `@orcid/bibtex-parse-js` | hand-written |
| ------------------------------- | -------------------------------------------------- | ---------------------------------------- | ---------------- | ------------------------ | ------------ |
| Licence (gate)                  | ISC ✓                                              | MIT ✓                                    | MIT ✓            | MIT ✓                    | —            |
| Offline, no network deps (gate) | ✓                                                  | ✗ peer `core` brings `sync-fetch-undici` | ✓                | ✓                        | ✓            |
| Edge-case correctness (40)      | best in class (Better BibTeX)                      | good                                     | fair             | poor (no LaTeX decoding) | poor         |
| Maintenance (25)                | 11.0.0, 2026-09-09                                 | 0.9.0, 2026-09-18                        | 0.16.4, **2022** | 0.0.25, 2022             | ours forever |
| CSL output (20)                 | ✗, we map                                          | ✓                                        | ✓                | ✗                        | ✗            |
| Footprint (15)                  | 11 deps (unified-latex), size to be measured in M1 | 3 + core                                 | 2 deps           | 0 deps                   | 0            |
| **Verdict**                     | **chosen**                                         | fails offline gate                       | unmaintained     | too shallow              | rejected     |

Citation-js would be the easy choice, since it outputs CSL directly. It's rejected because its
plugins require `@citation-js/core`, which depends on a network fetch library. Erti's privacy
promise is audited dependency by dependency, and a parser has no reason to be able to reach the
network. **M1 check:** measure the bundled size of `@retorquere/bibtex-parser`. If it adds more
than 500 KB gzipped to the frontend, load it lazily on first import.

## Alternatives

- **Pandoc.** Excellent output and a 100+ MB external binary. The offline, self-contained
  principle that rejected GROBID rejects this too.
- **`docx-rs` in Rust.** Viable, but it moves the document model across IPC, against ADR 001.
- **Hand-written BibTeX parser.** The format's edge cases are an open-ended maintenance load.

## Consequences

- Two new runtime dependencies (`docx`, `@retorquere/bibtex-parser`), each license-checked and vendored in the lockfile like
  everything else, and listed in the About screen's third-party notices (M7).
- Imported files named by Zotero's BibTeX export (`file = {…}`) are attached and queued for
  ingest. Missing paths are reported, not silently skipped.
