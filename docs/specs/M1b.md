# M1b — Sources, notes and import

### M1b-1 Spike: aliases hold

Refs: ADR-3 · Depends on: M1a-8

- AC-1 On a throwaway branch: create a no-file source `erti:<uuid>`, cite it in a manuscript,
  attach a PDF (new `sources` row + alias), and every citation still renders.
- AC-2 A search result from the attached PDF reports the canonical id, and citing it inserts
  the canonical id.
- AC-3 Merging two cited ids keeps both manuscripts rendering the same work.
- AC-4 Written up in ADR 003 as "Spike result". If it fails, stop and raise it: the fallback
  (rebuilding tables) is a plan change.

### M1b-2 Library migration 6

Refs: ADR-3, ADR-4 · Depends on: M1a-5, M1b-1

- AC-1 Adds `source_aliases`, `source_notes` and `source_note_embeddings` as specified in the
  ADRs, idempotently, and frozen by fingerprint.
- AC-2 Upgrades a real v5 library built from the frozen migrations, with a backup taken first.
- AC-3 `schema.rs` documents that `sources.sha256` holds `erti:` ids too.

### M1b-3 One canonical-id resolver

Refs: ADR-3 · Depends on: M1b-2

- AC-1 `canonical(id)` exists in Rust and TS and is used by: citation rendering, search
  results, notes, `source_set` membership, and the envelope.
- AC-2 Both suites read one shared fixture (`tests/fixtures/aliases.json`) and agree on it.
- AC-3 Alias chains are rejected on write.

### M1b-4 Remove a source

Refs: ADR-3, UX-4 · Depends on: M1b-3

- AC-1 The UX-4 dialog, with counts of citations (across the open project's manuscripts),
  notes and highlights.
- AC-2 Removal cascades (chunks, locations, annotations, source notes, aliases pointing at it)
  and leaves the PDF file untouched.
- AC-3 Afterwards the citations render from the manuscript envelope (M1a-8 AC-6), not as
  errors.
- AC-4 The success toast points to Settings › Library backups.

### M1b-5 Add a source by hand

Refs: ADR-3, UX-2 · Depends on: M1b-2, M1a-6

- AC-1 Sources › **Add ▾ › Enter details…** opens the sidebar in create mode: type first, then
  that type's fields, with required ones marked.
- AC-2 Save creates an `erti:<uuid>` source in the library and adds it to the project.
- AC-3 It renders correctly in APA, Chicago notes and IEEE (book, book section, web page,
  report, thesis): a table test through citeproc.
- AC-4 The Sources table shows "No file" with **Attach PDF…** for it (UX-2).
- AC-5 The existing edit sidebar shows the type and fields for sources ingested before
  `zotero_type` existed.

### M1b-6 Add from a DOI

Refs: UX-2 · Depends on: M1b-5

- AC-1 **Add ▾ › From a DOI…** resolves through doi.org when lookups are on, reusing
  `resolve.ts`.
- AC-2 With lookups off, it says so and offers "Enter details" prefilled with the DOI.
- AC-3 A DOI already in the library opens that source instead of duplicating it.
- AC-4 ISBN lookup is out of scope (plan-v1.md §6).

### M1b-7 Attach a PDF to a source

Refs: ADR-3, UX-3 (File tab) · Depends on: M1b-3

- AC-1 **Attach PDF…** (table row and File tab) picks a file, ingests it, and records the alias.
  The row's state follows pending → ready.
- AC-2 **Attach another** supports a second file (preprint + published).
- AC-3 The File tab shows each file's location, or "file not found" when it has moved, with
  Open and Show in folder.

### M1b-8 Notes on a source

Refs: ADR-4, UX-3, UX-5 · Depends on: M1b-2

- AC-1 The sidebar has **Details · Notes (n) · File** tabs. Notes lists source notes, then marks
  by page.
- AC-2 **New note**: note (Markdown), optional quote, optional page as printed, label; saved
  with ⌘↩.
- AC-3 Notes with a page offer **Cite with p. N**, which inserts a citation with that locator.
- AC-4 Source notes are embedded (quote + body), skipped when unchanged, and appear in the
  Notes panel search and follow list alongside marks.
- AC-5 Notes export (Markdown and JSON sidecar) includes source notes, and the sidecar imports
  back.

### M1b-9 Import a bibliography

Refs: ADR-9, UX-6 · Depends on: M1b-5, M1b-7

- AC-1 **Add ▾ › Import a bibliography…** accepts `.bib`, `.ris` and CSL-JSON `.json`.
- AC-2 BibTeX goes through `@retorquere/bibtex-parser` **with sentence-casing off**. Checked
  2026-09-24: the default lowercases titles ("Übermensch & Co." → "übermensch & co."). A
  fixture pins exact title case.
- AC-3 The field mapping to CSL is table-tested over real exports committed as fixtures
  (Zotero Better BibTeX, Mendeley, JabRef, Google Scholar). RIS gets its own table.
- AC-4 The UX-6 preview comes before any write: new, already in library (DOI, then normalised
  title + year + first author), PDFs to attach, PDFs not found, and unreadable entries with line
  numbers.
- AC-5 The parser is loaded lazily (measured: 109 KB gzip) and adds nothing to startup.
- AC-6 10k entries import in under 30 s on the dev machine, with progress shown.

### M1b-10 Shape guards and size limits

Refs: SEC-3, SEC-4 · Depends on: —

- AC-1 One guard module validates the manuscript envelope, CSL-JSON (envelope and imports),
  annotation sidecars and parsed BibTeX/RIS. Unknown fields are dropped; strings, arrays and
  depth are capped.
- AC-2 Each format has a hostile-fixture test.
- AC-3 Oversized inputs are refused with a message naming the limit. Limits are provisional
  until M6-2.

**M1b Verify:** cite a print book with a pinpoint in APA, Chicago notes and IEEE; attach its
PDF and every citation still renders; import a 500-entry Zotero `.bib` over an ingested folder
with no duplicates; E2E journey 3 is green.
