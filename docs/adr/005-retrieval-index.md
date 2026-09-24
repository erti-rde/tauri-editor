# ADR 005 — An in-memory vector index in Rust, rebuilt from SQLite

**Status:** Accepted, 2026-09-24. Numbers are estimates until M2 measures them.

## Context

`search_similar` runs `SELECT … FROM chunks` over the whole table on every query, unpacks every
BLOB, and computes scalar cosine that re-derives both norms per pair. Measured corpus: 5,601
chunks for 20 papers. At the 1.0 target of 200+ papers that's ~56,000 chunks and ~86 MB of
vectors read from disk **per query**. The writing companion (M3) queries on every paragraph
change, and the Notes panel already follows the cursor.

## Decision

- **One index per open library**, held in Rust state: a contiguous row-major `Vec<f32>` of
  **L2-normalised** vectors plus a parallel `Vec<Entry { kind, id, canonical }>`, where `kind` ∈
  {chunk, annotation, source_note}. Similarity is a dot product.
- **Built** lazily on first query after `open_library`, in `spawn_blocking`. **Kept current**
  by the same commands that write: `store_chunks`, `save_annotation`, source-note saves, deletes
  and alias changes. There's no background sync, because the writers are the only way data
  changes.
- **SQLite stays the source of truth.** The index can always be dropped and rebuilt, so it
  needs no migration of its own. On a model change (`embedding_meta`), it's rebuilt.
- **Search** is brute force: `rayon` over rows for batches, sequential for a single query.
  Top-k with a bounded heap. Filters (project set, kinds) are applied before scoring.
- **Budget, measured in M2:** single-paragraph query over 56k rows < 50 ms; index build < 2 s;
  memory ≈ 56k × 384 × 4 B ≈ **86 MB**. If memory breaks the budget: int8-quantise the
  resident matrix (~21 MB) and re-rank the top 200 in f32 from SQLite.

## Alternatives

- **`sqlite-vec` extension.** Keeps everything in SQL, but means loading a native extension
  through sqlx on three platforms, and a query still scans. Worth re-evaluating if the in-process
  index proves hard to keep consistent.
- **HNSW / ANN (`usearch`, `hnsw_rs`).** Approximate results, heavier builds and deletes, and
  unnecessary below ~10⁶ vectors. Brute force over 56k dot products is milliseconds.
- **Keep scanning SQLite.** It's the current behaviour, and it's what the M3 companion can't
  afford.

## Consequences

- `ScoredChunk`/`ScoredAnnotation` converge on one result type with a `kind`, and the Notes
  panel, citation search and companion share it.
- Consistency is a property of the write commands, so each one gets a test asserting the index
  sees the write.
- Normalising at load keeps stored vectors untouched, so no data migration is needed.
