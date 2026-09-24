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
