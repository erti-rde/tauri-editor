# ADR 003 — Works and files: one id per work, aliases for the rest

**Status:** Accepted, 2026-09-24. Replaces the sketch in plan-v1.md §3.1. Spiked first (M1.1).

## Context

A source's id is the SHA-256 of its PDF (`sources.sha256`), and that id is also the citation id
stored in manuscripts. 1.0 must cite works that have no file (a book read in print, a web page)
and must merge duplicates (a BibTeX import of a paper whose PDF is already ingested; a preprint and
its published version).

What rules out the textbook fix, a `sources(id)` table plus a separate `files(sha256)` table:
`chunks`, `locations`, `ingest_status`, `annotations` and `reading_positions` all declare
`FOREIGN KEY (sha256) REFERENCES sources(sha256)` with `foreign_keys = ON`. Re-pointing them
means rebuilding `annotations`, which holds work that cannot be regenerated, and schema.rs
already records the decision not to take that risk.

## Decision

Keep one table and one id column, and add a single mechanism for "these two ids are the same
work":

- A **file-backed** source keeps its SHA-256 as its id. A **no-file** source gets `erti:<uuid>`.
  Both live in `sources`; every existing foreign key stays valid.
- `source_aliases(alias TEXT PRIMARY KEY, canonical TEXT NOT NULL)`, library migration 6. An
  alias row says the alias id is the same work as the canonical id. Chains aren't allowed: the
  canonical is always a non-alias.
- **Attaching a PDF to a no-file source:** ingest the file as usual (it gets its own `sources`
  row, chunks and annotations), then add `alias = <file sha256>, canonical = erti:<uuid>`.
  Manuscripts that cite the uuid keep working unchanged.
- **Merging duplicates** is the same operation. The canonical is whichever id is already cited,
  or the older one.
- **One resolver, used at every boundary:** `canonical(id)` in Rust (queries) and TS (citation
  rendering, search results, the envelope in ADR 002). Search results, notes and highlights
  report the canonical id; metadata is read from the canonical row. CSL on an alias row is
  ignored.
- **Removing a source** (currently impossible: nothing deletes from `sources`) is added here. It
  deletes the row and cascades, **refuses while the work is cited** in an open project's
  manuscripts unless confirmed, and removes alias rows pointing at it.

## Alternatives

- **Rename `sha256` → `id` and split files out.** Correct, and costs a rebuild of five tables
  including `annotations`. Revisit only if aliases prove insufficient.
- **Re-key manuscripts when a PDF is attached.** Impossible for copies on co-authors' machines,
  and it rewrites user files as a side effect of a library operation.
- **Content-hash the metadata for no-file sources.** The id would change whenever a typo in a
  title is fixed.

## Consequences

- The column is still named `sha256` while holding `erti:` ids. This is documented in
  schema.rs, and the cost is accepted in exchange for not rebuilding tables.
- Every place that takes an id from a user-facing source must resolve it. A test asserts that
  search, notes and citation rendering agree on the canonical id after an attach and after a
  merge.
- Aliases compose with ADR 002: an envelope may carry either id, and resolution handles both.

## Spike result (2026-10-03, M1b-1)

**Aliases hold.** No table is rebuilt and every foreign key stays valid. The spike lives on the
branch `spike/M1b-1-aliases`, which is never merged: a prototype `source_aliases` table, a
one-lookup `canonical()`, an `alias_source()` that refuses chains, and a search that reports the
canonical id. Its tests run over the real migrations, the real queries and citeproc with APA:

- **Attach** (`attaching_a_pdf_to_a_cited_no_file_source`; TS: "a cited no-file source renders
  the same after its PDF is attached"). A cited `erti:<uuid>` source gets a PDF with its own row,
  chunks and a highlight, then an alias. `PRAGMA foreign_key_check` is clean, the citation
  renders identically before and after, and a citation inserted under the file's hash renders as
  the book too.
- **Search** (same test). A chunk from the PDF comes back as the uuid, and counts as in the
  project although `source_set` names only the uuid. Citing a result inserts the id search
  reports (`Result.svelte`), so it inserts the canonical id.
- **Merge** (`merging_two_cited_ids`; TS: "merging two cited ids keeps both manuscripts rendering
  the same work"). A PDF cited by one chapter and a hand-made entry for the same paper cited by
  another render the same text once merged. A chapter citing both gets one bibliography entry.
  Before the merge, citeproc treats them as two works, "2019a" and "2019b": the duplicate
  merging is for.
- **Remove** (`removing_a_work_takes_its_aliases_with_it`). With foreign keys on both columns,
  `ON DELETE CASCADE` removes alias rows when either id goes. The PDF's own row survives as a
  work of its own again.

What migration 6 and the resolver (M1b-2, M1b-3) take from it:

- **The table.** `source_aliases(alias, canonical)`, each a foreign key to `sources(sha256)`
  with `ON DELETE CASCADE`, plus `CHECK (alias <> canonical)` and an index on `canonical`.
  Removal's "removes alias rows pointing at it" then needs no code.
- **One write operation, no chains.** Making `a` an alias of `b` resolves `b` first, re-points
  every alias of `a` to the result, and refuses `a` itself. Promoting an alias to be the work
  (the published version over the preprint) is the same operation the other way round: its
  alias row is deleted first. Reads then need one lookup.
- **Boundaries the code shows, beyond the ones listed above:**
  - `project_sources` lists a work twice once a folder scan adds its PDF's hash to the
    `source_set`. The work's file path hangs off the alias row (`locations` is keyed by the
    file's hash), so "Open PDF" on a work reads its aliases' locations.
  - Search's `in_project` compares canonical ids on both sides.
  - Citing from a highlight (`Editor.svelte`, `citeSource`) inserts the annotation's own hash,
    which is the file's. Highlights reporting the canonical id, as decided above, covers it.
  - `snapshotSources` (the ADR 002 envelope) looks the library up by the cited id. After a merge
    it has to look up `canonical(id)`, or a save falls back to the snapshot the file carried.
  - `metadata_overrides` in a project is keyed by id, so an override made on an id later merged
    away would stop applying. Read it through the resolver, preferring the canonical's own.
  - The renderer resolves before it de-duplicates a cluster's ids, so citing both ids at one
    point renders the work once.
- **Unchanged.** A no-file work is `ready`, and its PDF's row is `pending` until ingested.
  Citability is read from the canonical row, so a citation doesn't flicker while the PDF
  ingests.
