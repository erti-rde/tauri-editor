# Retrieval benchmark baseline

Recorded reference numbers for the citation-retrieval pipeline. Every later change to
the embedding model, chunking strategy or tokenisation is compared against these —
the point is that quality claims are measured, not asserted.

## How to reproduce

```bash
./scripts/fetch-retrieval-corpus.sh                      # 20 open-access papers, checksum-verified
node scripts/eval/extract-chunks.mjs                     # stage 1: extract + chunk
cargo run --release --bin eval_retrieval                 # stage 2: embed + score
```

Stage 1 imports `src/lib/ingest/{extract,chunk}.ts` — the same modules the app uses, so
the benchmark cannot drift from what ships. Chunking can be varied with
`--target-chars`, `--overlap` and `--keep-references`.

Stage 2 uses the same `ort` session, tokenizer and pooling the app ships, so the
numbers reflect what users get rather than a reimplementation.

## Current — 2026-07-27 (structure-aware ingest)

|            |                                                                   |
| ---------- | ----------------------------------------------------------------- |
| Extraction | geometry-based spacing, column detection, running heads stripped  |
| Chunking   | section-aware, references excluded, 380-char target, 15 % overlap |
| Corpus     | 20 papers → **5601 chunks** (82 of 410 pages detected two-column) |

| metric         | baseline | first pass | after review fixes | change      |
| -------------- | -------- | ---------- | ------------------ | ----------- |
| **Recall@1**   | 80.0 %   | 84.0 %     | **88.0 %**         | **+8.0 pt** |
| Recall@5       | 100.0 %  | 100.0 %    | 100.0 %            | —           |
| **MRR**        | 0.900    | 0.920      | **0.940**          | **+0.040**  |
| Queries missed | 5        | 4          | **3**              | −2          |
| Corpus embed   | 27.7 s   | 20.8 s     | **22.2 s**         | −20 %       |
| Throughput     | 290/s    | 220/s      | 252/s              | see below   |

The gain between the two passes came from **fixing data loss, not from tuning**. Two chunking
bugs were dropping content: an enumerated sentence such as `1. We evaluate…` was classified as a
heading (and heading text is never indexed), and everything printed after the reference list —
appendices included — was discarded. Recovering that content added roughly a thousand chunks and
four points of Recall@1.

**Throughput fell but ingest got faster.** Chunks are roughly 1.75× larger, so
chunks-per-second is not comparable across the change. Time to embed the whole corpus —
what a user waits for — dropped from 27.7 s to 20.8 s.

Every remaining miss ranks 2nd, against a topically adjacent paper.

## Previous baseline — 2026-07-26

|               |                                                                              |
| ------------- | ---------------------------------------------------------------------------- |
| Model         | all-MiniLM-L6-v2, int8-quantised (`QUInt8`, IntegerOps)                      |
| Embedding dim | 384                                                                          |
| Tokeniser     | fixed padding + truncation at **128 tokens**                                 |
| Chunking      | `llm-chunk`, `minLength: 100` chars, sentence splitter, **no overlap**       |
| Corpus        | 20 papers → **8031 chunks**                                                  |
| Queries       | 25 labelled, paraphrased-claim → gold source                                 |
| Machine       | Apple Silicon, release build, `available_parallelism() - 1` intra-op threads |

| metric        | with `[CLS]`/`[SEP]` | without (pre-fix behaviour) |
| ------------- | -------------------- | --------------------------- |
| Recall@1      | **80.0 %**           | 80.0 %                      |
| Recall@5      | **100.0 %**          | 100.0 %                     |
| Recall@10     | **100.0 %**          | 100.0 %                     |
| MRR           | **0.900**            | 0.890                       |
| Throughput    | **290 chunks/sec**   | 291 chunks/sec              |
| Query latency | **5 ms**             | 5 ms                        |

Special tokens are now enabled in production. The measured gain is small but free and
matches how sentence-transformers embeds text.

## Reading these numbers honestly

- **Recall@5 of 100 % is not a licence to stop.** With 20 sources, returning the right
  paper in the top 5 is a weak bar. **Recall@1 (80 %) is the metric to move**; all five
  failures rank 2nd, i.e. a near-miss against a topically adjacent paper.
- **The corpus is deliberately clustered** (mostly deep learning). Semantically adjacent
  papers make discrimination _harder_ than a corpus spanning unrelated fields would. It
  is still a proxy: it under-represents the messiness of real citation contexts, which
  often support a claim with several works at once or cite for method rather than result.
- **Queries paraphrase rather than quote.** Copying abstract wording would turn this into
  a lexical-overlap test and flatter every model.
- **The 128-token truncation is a hard ceiling on chunk size.** Roughly 500 characters.
  The 380-character target leaves headroom for `[CLS]`/`[SEP]` and for words costing more
  than one token. Raising it further needs the tokenizer config changed too, or the extra
  text is silently discarded.
- **Throughput scales the ingest estimate**: 290 chunks/sec ≈ 1.4 s for a typical
  400-chunk paper, so a 200-paper corpus is roughly 4–5 minutes on this machine. A model
  with materially more parameters will move this a lot; measure it, don't assume.

---

## The eval set, and what it can decide

The model bake-off (§5.3 of the plan) has been deferred since Phase 2 because the
eval set could not discriminate: Recall@5 sat at 100 % on 25 queries, so a
genuinely better model would have scored identically.

The set is now **65 queries**, reported in two slices. The original 25 are kept
and marked `easy` — near-quotes carrying each paper's own distinctive vocabulary
— so the recorded baseline above stays comparable. The 40 new ones are `hard`:
paraphrased claims whose gold paper sits beside near-identical neighbours in
this corpus, avoiding the signature terms that made the easy set separable by
vocabulary alone. BERT against RoBERTa and ELMo; LayerNorm against BatchNorm;
DPR against RAG; VGG against ResNet against ViT.

| set  | n   | R@1    | R@5   | R@10  | MRR   |
| ---- | --- | ------ | ----- | ----- | ----- |
| all  | 65  | 87.7 % | 100 % | 100 % | 0.934 |
| easy | 25  | 92.0 % | 100 % | 100 % | 0.960 |
| hard | 40  | 85.0 % | 100 % | 100 % | 0.918 |

The hard set separates at Recall@1 and MRR — seven points and 0.042 below the
easy set — so those two metrics are now usable.

**Recall@5 is still saturated, and harder queries cannot fix it.** With 20
papers, the top five covers a quarter of the corpus; any competent model puts
the gold source in there. That needs a bigger corpus, not better questions.

### How much of a difference this can detect

Comparing two models by their headline percentages treats them as independent
samples, which is the wrong test: they answer the same queries, so the
comparison is paired and only the queries where they disagree carry information.
McNemar on those discordant pairs is far more sensitive than comparing two
proportions.

Even so, with 8 misses remaining at Recall@1, a challenger has to fix about six
of them without breaking any to reach p < 0.05. So this set can detect a **large**
improvement and cannot detect a small one — which is worth knowing before
reading any bake-off result as a decision.

`eval_retrieval` writes per-query ranks to `last-run.json` so two runs can
actually be compared that way, rather than by their summary lines.
