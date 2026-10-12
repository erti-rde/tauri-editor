# Attribution check: labelled sentences

The harness for the attribution check (M4-1, ADR 006). This set was built before the check, so
that its thresholds are chosen from measurements (M4-4).

## How to run

```bash
./scripts/fetch-retrieval-corpus.sh       # the 20 papers of the retrieval benchmark
node scripts/eval/extract-chunks.mjs      # chunked by the app's own ingest
pnpm eval:attribution                     # confusion matrix, written to last-run.json
```

**The harness refuses to score when a label no longer matches the corpus.** For example, a
change to extraction or chunking might move a copied sentence or repair an artefact. It then
lists each label that no longer holds. A number measured against the wrong text would mislead.

`pnpm test` checks that the labels are consistent with each other, without the corpus, and that
`last-run.json` covers the set as it stands.

## What's here

`sentences.json` holds:

- **`sentences`**: manuscript sentences, each with:
  - `category`: how it came to be written;
  - `expect`: what the check should report about it;
  - `cites`: the works its citations name;
  - `from`: where its words come from;
  - `copied`: the words it shares with that source.
- **`sources`**: sources that aren't among the retrieval corpus's papers:
  - two invented books with no file, which the source notes are on;
  - twelve invented abstracts that carry stock phrasing.
- **`notes`**: source notes with quotes, plus one mark. Their quotes are corpus too (ADR 006).
- **`documents`**: two other manuscripts in the same project, for self-reuse.

The check reads the retrieval corpus's chunks, the stock sources, the notes' quotes and the other
documents. Each sentence is checked on its own, with its own citations.

## The categories

| category                  | what it is                                                                   | expect           |
| ------------------------- | ---------------------------------------------------------------------------- | ---------------- |
| `verbatim_uncited`        | a source's words, whole or as a long run inside the writer's own, not cited  | `uncited`        |
| `verbatim_cited_unquoted` | a source's words, cited to that source, without quotation marks              | `none`           |
| `quoted_cited_exact`      | quoted exactly and cited, including quotations with an ellipsis              | `none`           |
| `drifted_quote`           | in quotation marks and cited correctly, but the words differ from the source | `drifted_quote`  |
| `wrong_source`            | one paper's words, quoted or not, cited to another                           | `wrong_source`   |
| `self_reuse`              | the writer's words from another document in the project                      | `self_reuse`     |
| `stock_phrase`            | uncited phrasing that ten sources or more share                              | `none`           |
| `clean_paraphrase`        | the idea in other words, sharing no four-word run with the source            | `none`           |
| `pdf_artefact`            | copied words that extraction or pasting mangled on one side                  | mostly `uncited` |

The four kinds are the four groups of the Check panel (docs/ux.md, UX-7).

## Labelling choices

- **Verbatim, cited and unquoted, expects nothing.** UX-7 has no group for words that are cited
  to their source but not marked as quoted. The citation is there and points the right way. If
  that should become a finding, it is a change to UX-7 first, then to these labels.
- **An ellipsis or a changed capital is not drift.** Quoting allows both. A dropped, changed or
  reordered word is drift, and so is rewriting the subject inside the quotation marks (`dq-10`).
- **Stock phrases come from invented sources.** No six-word run is in more than six of the
  corpus's 20 papers. The `stock-*` sources are short invented abstracts made of common academic
  phrasing. With them, each stock phrase is in at least ten sources. The harness counts this
  and refuses a phrase in fewer.
- **Artefacts appear on both sides:**
  - On the corpus side, `as_extracted` holds the text exactly as extraction left it. Examples are
    a `tt` ligature turned into a control character, a lost hyphen and a stray formula symbol.
  - On the manuscript side, the sentence is what pasting from a PDF gives: `ﬁ`, `ﬂ` and `ﬀ`
    ligatures, a soft hyphen, a no-break space, or the hyphen of a line break.
  - Four of these sentences (`pa-12`–`pa-15`) have ligatures close enough together that no six
    words run clean. Without normalisation they can't match at all.
- **Paraphrases are checked for honesty.** Each one names the sentence it restates, and the
  labels are refused if the two share four words in a row.
- **The books, their notes and the two documents are invented.** The quotes in them are not
  from any real book.

## Adding a sentence

1. Add it with the next id in its category.
2. Run `pnpm test src/lib/attribution` for the labels, then `pnpm eval:attribution` against the
   corpus.
3. Commit the new `last-run.json` with it.
