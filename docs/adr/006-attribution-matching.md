# ADR 006 — Index the manuscript, stream the corpus

**Status:** Accepted, 2026-09-24. Replaces the "shingle index over the library" in plan-v1.md §3.5.

## Context

The attribution check (M4, review mode, verbatim and near-verbatim) needs, for each manuscript
sentence, the corpus passages sharing long runs of words with it, plus how common each shared
phrase is across the corpus, so that stock phrasing is discounted.

A persistent inverted index over the library is the obvious design and the wrong size: ~56k
chunks × ~60 words ≈ 3.4M shingle postings. As a `HashMap<u64, Vec<u32>>`, that's well over
100 MB resident, rebuilt or migrated whenever ingest runs, and consulted only when someone asks
for a review.

## Decision

Invert which side is indexed:

1. Normalise and shingle **the manuscript**: NFKC, casefold, strip punctuation, unify
   ligatures/quotes/dashes, and word 6-grams hashed to `u64`. A 5,000-word manuscript is ~5,000
   hashes: a `HashMap<u64, Vec<SentenceRef>>` of a few hundred KB.
2. **Stream the corpus** once from SQLite: chunk text, annotation quotes, source-note quotes, and
   the project's other manuscripts. Shingle each passage the same way and probe the manuscript
   map. Record a hit per (sentence, passage); count document frequency **only for shingles that
   hit**.
3. Collapse hits into runs of consecutive shingles → matched spans with a length and a
   `verbatim_score`. Discount runs made mostly of high-document-frequency shingles.
4. Classify each span with the citation-aware and quote-aware rules (a canonical-id citation
   nearby, inside quotation marks, exact vs drifted), all in a pure TS module over the results.

Chunk overlap (15%) makes the same text appear in two chunks, so hits are deduplicated by source
and character range.

## Alternatives

- **Persistent inverted index.** Faster per check, and pays that cost in memory and ingest
  complexity for a feature that runs on request.
- **Embeddings first, then string match on candidates** (the original epic). Measured cost is
  seconds per pass, and cosine over 380-char chunks dilutes a single copied sentence. It's
  deferred to the paraphrase pass after 1.0, which will use ADR 005's index.
- **Suffix automaton / rolling-hash LCS per pair.** More exact on span edges, and quadratic
  without the shingle prefilter. It can be applied to the matched pairs only, if the edges need
  it.

## Consequences

- There's no stored state, so nothing to migrate or invalidate, and a check is a pure function
  of (manuscript, corpus).
- Cost is O(corpus words): ~3.4M hash probes plus reading ~20 MB of text, expected well under a
  second. M4 measures it and records it.
- Normalisation is shared with the extractor's text, so PDF artefacts (hyphenation, ligatures)
  must be normalised identically on both sides. Tests cover that on real extracted chunks.
