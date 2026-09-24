# ADR 001 — Pure TS for document transforms, Rust for data and vectors

**Status:** Accepted, 2026-09-24. Codifies what the code already does.

## Context

1.0 adds DOCX export, three import formats, a sentence walker, a shingle matcher, a retrieval
index and snapshotting. Without a rule, each lands wherever its author happens to be working. The
codebase has already converged on a split, and the defects that were found were where that split
was broken (plan.md: ingest decisions buried in untestable `pdf_handlers.ts`; embeddings and
cosine computed in JS on the main thread, D6).

## Decision

- **Pure TypeScript modules** for anything that transforms a document or a record: ProseMirror
  JSON → LaTeX/DOCX, BibTeX/RIS → CSL-JSON, sentence walking, dedup rules, citation rendering. No
  Tauri, Svelte or path-alias imports in these modules, so vitest and the benchmarks run exactly
  the code the app runs (`chunk.ts`, `extract.ts`, `latex.ts` already work this way).
- **Rust** for anything that touches vectors, the databases, the filesystem at scale, or CPU-heavy
  loops: embedding, similarity, the retrieval index, corpus scans, snapshots, backups. Only
  results cross IPC. Vectors never do.
- **Svelte components** orchestrate. They call the two layers above and hold no decisions a test
  would want to reach. Where a decision is found inside a component, it moves out (the
  `pipeline.ts` precedent).

## Alternatives

- **Everything in Rust.** Better performance for export and parsing, but those aren't hot paths.
  It would move the document model across IPC and duplicate the ProseMirror schema in Rust.
- **Everything in TS.** Already tried for vectors, and it's D6: the main thread blocked, and
  vectors serialised as JSON.

## Consequences

- A new feature's placement is decided by what it touches, not by who writes it.
- Two test stacks stay necessary (vitest + cargo test), and both run in CI.
- `PdfReader.svelte` (1,869 lines) and `Editor.svelte` (750) break the "components hold no
  decisions" rule in places. Extracting from them happens when a milestone touches them, not as a
  separate refactor.
