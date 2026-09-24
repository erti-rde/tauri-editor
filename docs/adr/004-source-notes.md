# ADR 004 — Source notes as their own table in the library

**Status:** Accepted, 2026-09-24.

## Context

Notes today are annotations: always on a PDF page (`annotations.page INTEGER NOT NULL`, `kind IN
('highlight','area','page-note')`). Researchers also need a note about a work as a whole, and
notes on works they read on paper, often transcribing a quote with its printed page. Those
quotes are the highest-value input to the attribution check (ADR 006) and to pinpoint citations.

## Decision

`source_notes` in the **library** DB, migration 6 alongside `source_aliases`:

| column       | why                                                         |
| ------------ | ----------------------------------------------------------- |
| `id` uuid    | survives the JSON sidecar round-trip, as annotations do     |
| `sha256`     | FK to `sources`, cascades; always the **canonical** id      |
| `body`       | Markdown; the note itself                                   |
| `quote`      | exact transcribed words, nullable; used verbatim by ADR 006 |
| `page_label` | as printed, nullable; becomes the citation's locator        |
| `label_id`   | same eight labels as highlights                             |
| timestamps   |                                                             |

Embeddings go in `source_note_embeddings(id FK → source_notes, embedding, text_hash)`,
mirroring `annotation_embeddings` so that deletes cascade and unchanged text isn't re-embedded.
The embedded text is `quote` + `body`.

## Alternatives

- **A fourth annotation `kind` with a nullable page.** It needs both the `kind` CHECK widened and
  `page` made nullable, and SQLite can do neither without rebuilding `annotations`.
- **Notes in the project DB.** Notes follow the paper across projects. That's the whole reason
  annotations live in the library.
- **One generic `note_embeddings(kind, id)` table.** No FK is possible across two parents, so
  deletes would leave orphans.

## Consequences

- Every note surface (Notes panel, search, sidecar export and import, writing companion,
  attribution check) reads the union of annotations and source notes behind one query API
  (ADR 005). No surface special-cases either kind.
- A source note on a no-file source is the complete "print book" workflow: create source → write
  note with quote and page → cite with pinpoint.
