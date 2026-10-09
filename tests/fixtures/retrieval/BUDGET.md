# Retrieval index budget

ADR 005 budgeted the in-memory index for the 1.0 target of 200 papers, about 56,000 rows:

- a single-paragraph query under 50 ms;
- a build under 2 s;
- about 86 MB resident.

These are the measurements (M2-4). Every later change to the index, the row count it's sized for
or the model's width is compared against them.

## How to reproduce

```bash
cargo run --release --bin bench_index                    # 500 paragraphs, 10 builds
cargo run --release --bin bench_index -- --queries 1000 --builds 20
```

It needs nothing fetched. The binary:

1. generates the library from a fixed seed, then writes it through the app's own writers
   (`register_source`, `store_chunks`, `save_annotation`, `save_source_note` and their
   embeddings) into a fresh library and project under the system temp directory;
2. measures it in a second process, so the generator's memory isn't counted;
3. deletes the library when it's done.

The paragraph's embedding is measured too, using the model in `src-tauri/resources`.

**The library** has 56,000 rows, each 384 wide (the shipped model's width):

- 200 files × 270 passages, the measured corpus's 280 per paper;
- 1,500 marks;
- 500 source notes;
- 30 of the files are in the open project.

Each paper's rows sit near a centre of its own, and each query paragraph sits near one paper's
centre. The vectors are synthetic. Brute force scores every row the filter lets through, whatever
the row holds, so time and memory depend on how many rows there are and how wide, not on what
the vectors mean.

**The same library everywhere.** The generator uses only integer arithmetic and exact float
operations, with no `libm` call whose last bit could differ between platforms. Its sha256 is
pinned in a test (`the_same_56k_row_library_is_generated_from_the_seed_on_any_machine`, run by
`cargo test`), and every run prints it:

```
seed      : 0x00e2714000560000
generated : b3ab4a4880995b377b8f8295a98f5a5ca5ce447f0ccbc8dd7bdcf2f2b2fcdd4a
```

## Measured — 2026-10-09

Apple M2 Pro, macOS, release build. The table shows three runs of `bench_index` with the
defaults. Each figure is from the first run. The headline figures also give, in brackets,
the range over all three.

| measure                                      | budget  | p50                     | p95                     |
| -------------------------------------------- | ------- | ----------------------- | ----------------------- |
| **query**: every kind, whole library, top 20 | < 50 ms | **14.1 ms** (14.0–14.1) | **14.3 ms** (14.3–14.4) |
| query: marks and notes only, top 20          |         | 1.7 ms                  | 1.8 ms                  |
| query: the project's passages, top 5         |         | 2.4 ms                  | 2.6 ms                  |
| scoring alone, every row, top 20             |         | 13.0 ms                 | 13.2 ms                 |
| embedding the paragraph (128 tokens)         |         | 7.7 ms                  | 11.7 ms                 |
| **paragraph to results** (embed + query)     |         | **23.3 ms** (21.8–23.3) | **28.1 ms** (25.1–28.1) |
| **build**: read + pack, as on first query    | < 2 s   | **189 ms** (179–190)    | **200 ms** (197–200)    |
| build: reading every vector from SQLite      |         | 151 ms                  | 156 ms                  |
| build: normalising and packing               |         | 40 ms                   | 43 ms                   |

| memory (MB)                       | resident (`ps`) | physical footprint  |
| --------------------------------- | --------------- | ------------------- |
| before the first build            | 17.2            | 11.9                |
| every vector read, not yet packed | 139.3           | 70.7                |
| the index built and held          | 175.9           | 116.2               |
| the index dropped                 | 169.4           | 28.9                |
| after 20 more builds, none held   | 392.0           | 40.6                |
| peak, over the whole run          |                 | 144.8 (143.3–151.2) |

The index's own heap, counted rather than observed, is **87.7 MB**: an 82.0 MB matrix (56,000 ×
384 × 4 B), plus 5.7 MB of keys, owners and widths.

## Reading these numbers

- **All three budgets hold, with room.**
  - **Query:** a paragraph in, results out, in 28 ms at p95. That's 14 ms of query and the rest
    embedding the paragraph. The query alone uses under a third of its 50 ms.
  - **Build:** a tenth of its 2 s. Most of it is reading the vectors out of SQLite, not packing
    them.
- **Holding the index costs what ADR 005 estimated.** Dropping it frees 87.3 MB of physical
  footprint (85.1 and 89.0 in the other runs), against the 87.7 MB counted and the 86 MB
  budgeted. So AC-3's int8 index with an f32 re-rank isn't built.
- **A build briefly needs about 50 MB more than it keeps.** The footprint peaks at about 145 MB
  while every row is read, then falls to 116 MB once the rows are packed. The rows exist twice
  for a moment: once as they're read, and once as the matrix. Reading straight into the matrix
  would remove that. That idea is in plan-v1.md §5, since the budget doesn't call for it.
- **Repeated builds don't accumulate.** After 20 more builds, the footprint with no index held
  is back to 41 MB. The resident set `ps` reports keeps growing, to 392 MB, but that's pages the
  allocator has freed and macOS hasn't taken back yet. Physical footprint is what Activity
  Monitor shows, and it doesn't count them. So on macOS, read the footprint column. Elsewhere,
  where `vmmap` doesn't exist, only the resident set is printed.
- **No `rayon`.** ADR 005's amendment left it until measurements called for it. A sequential
  scan of every row takes 13 ms, so they don't.
- **The filter does the work.** "Your notes" (M3-1) scores only marks and source notes: 2,000
  rows, in 1.7 ms. The project's passages take 2.4 ms. Only a search of every kind across the
  whole library touches all 56,000 rows.
- **The tail.** The worst single query in a run reached 24–38 ms, and the worst paragraph to
  results 35–53 ms. That's the 1 in 500, when the machine was busy elsewhere. M3 queries when the
  cursor leaves a paragraph or after 600 ms idle, never per keystroke. So a slow query delays one
  update.
- **One machine, synthetic rows.** This is an M2 Pro. On a machine half as fast, the query stays
  inside budget, but paragraph to results reaches about 50 ms at p95. M6-1 measures the build
  time and peak memory again, on 200 real papers. The 0.9 beta (M7b) is the chance to run
  `bench_index` on slower hardware.
