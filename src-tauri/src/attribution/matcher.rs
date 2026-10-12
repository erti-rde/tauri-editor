//! Index the manuscript, stream the corpus past it (M4-3, ADR 006).
//!
//! The manuscript's sentences are cut into word 6-grams and hashed into a map.
//! Each corpus passage is shingled the same way as it streams past and probed
//! against the map. Only shingles that hit are counted for document frequency,
//! so a library of 56k chunks costs a few million hash probes and no index.
//!
//! What comes out is spans: a run of a sentence's words shared with one
//! passage, with the frequency of each shared shingle across the corpus. What
//! a span means (uncited, a drifted quotation, a citation to the wrong work) is
//! the classifier's question, in TypeScript (M4-4).

use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasherDefault, Hasher};

use super::normalise::each_word;

/// Words in a shingle. Six is long enough that two sources sharing one is
/// rarely chance, and short enough that a quotation of a single clause is
/// found (ADR 006).
pub const SHINGLE: usize = 6;

/// Words two runs of shared shingles may be apart and still be one span. A
/// quotation with a word changed loses the six shingles that word is in; the
/// runs either side are still one borrowing.
pub const MAX_GAP: u32 = 4;

/// The shingle hashes are already mixed, so hashing them again is wasted work.
#[derive(Default)]
struct PassThrough(u64);

impl Hasher for PassThrough {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, _: &[u8]) {
        unreachable!("only u64 keys are hashed")
    }
    fn write_u64(&mut self, n: u64) {
        self.0 = n;
    }
}

type Map<V> = HashMap<u64, V, BuildHasherDefault<PassThrough>>;

/// FNV-1a over the word's bytes, so the same word hashes the same way on every
/// run and every machine.
fn hash_word(word: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in word.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

/// A shingle's hash from its words' hashes, order-sensitive.
fn hash_shingle(words: &[u64]) -> u64 {
    let mut h: u64 = 0x9e37_79b9_7f4a_7c15;
    for &w in words {
        h = (h ^ w).wrapping_mul(0xff51_afd7_ed55_8ccd).rotate_left(29);
    }
    // A final mix, so the low bits a hash map buckets on are spread.
    h ^= h >> 33;
    h = h.wrapping_mul(0xc4ce_b9fe_1a85_ec53);
    h ^ (h >> 33)
}

fn shingles(text: &str, words: &mut Vec<u64>, out: &mut Vec<u64>) {
    words.clear();
    out.clear();
    each_word(text, |w| words.push(hash_word(w)));
    if words.len() >= SHINGLE {
        out.extend(words.windows(SHINGLE).map(hash_shingle));
    }
}

/// A run of one sentence's words shared with one passage.
#[derive(Debug, Clone, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    /// The sentence, by its index in what was checked.
    pub sentence: u32,
    /// The passage, by the index it was fed with. In a check's result, its
    /// index in `passages`.
    pub passage: u32,
    /// The span's first word in the sentence, and one past its last, counted
    /// in normalised words.
    pub sentence_words: [u32; 2],
    /// The same in the passage.
    pub passage_words: [u32; 2],
    /// How many of the sentence's words in the span are in a shared shingle.
    pub shared_words: u32,
    /// `shared_words` over the span's length on the sentence side: 1 when the
    /// words run unbroken, less where words were changed between runs.
    pub verbatim_score: f32,
    /// For each distinct shingle the span shares, how many sources hold it,
    /// in no particular order. Stock phrasing is in many; a borrowing from one
    /// paper is in one.
    pub sources: Vec<u32>,
}

/// One shared shingle: where it starts in the sentence and in the passage.
#[derive(Clone, Copy)]
struct Hit {
    sentence: u32,
    at_sentence: u32,
    at_passage: u32,
    shingle: u64,
}

pub struct Matcher {
    /// Shingle → each place in the manuscript it starts.
    manuscript: Map<Vec<(u32, u32)>>,
    /// Shingle → the sources it has been seen in. Only shingles that hit.
    seen_in: Map<HashSet<u32>>,
    source_ids: HashMap<String, u32>,
    /// Spans so far, before frequencies are known, with each one's source.
    found: Vec<(u32, Span, Vec<u64>)>,
    words: Vec<u64>,
    passage_shingles: Vec<u64>,
    hits: Vec<Hit>,
}

impl Matcher {
    /// Index the manuscript's sentences, in the order spans will name them.
    pub fn new<S: AsRef<str>>(sentences: &[S]) -> Self {
        let mut manuscript: Map<Vec<(u32, u32)>> = Map::default();
        let (mut words, mut grams) = (Vec::new(), Vec::new());
        for (index, sentence) in sentences.iter().enumerate() {
            shingles(sentence.as_ref(), &mut words, &mut grams);
            for (at, &gram) in grams.iter().enumerate() {
                manuscript
                    .entry(gram)
                    .or_default()
                    .push((index as u32, at as u32));
            }
        }
        Self {
            manuscript,
            seen_in: Map::default(),
            source_ids: HashMap::new(),
            found: Vec::new(),
            words,
            passage_shingles: grams,
            hits: Vec::new(),
        }
    }

    /// True when nothing in the manuscript can match: no sentence has six words.
    pub fn is_empty(&self) -> bool {
        self.manuscript.is_empty()
    }

    /// Probe one passage. `source` is the work it belongs to, for document
    /// frequency and for telling overlapping chunks of one work apart from
    /// another work. Returns whether it shares anything with the manuscript,
    /// so the caller keeps only the passages a span names.
    pub fn feed(&mut self, passage: u32, source: &str, text: &str) -> bool {
        let mut grams = std::mem::take(&mut self.passage_shingles);
        let mut words = std::mem::take(&mut self.words);
        shingles(text, &mut words, &mut grams);
        self.words = words;

        self.hits.clear();
        for (at, gram) in grams.iter().enumerate() {
            if let Some(places) = self.manuscript.get(gram) {
                for &(sentence, at_sentence) in places {
                    self.hits.push(Hit {
                        sentence,
                        at_sentence,
                        at_passage: at as u32,
                        shingle: *gram,
                    });
                }
            }
        }
        self.passage_shingles = grams;
        if self.hits.is_empty() {
            return false;
        }

        let next = self.source_ids.len() as u32;
        let source = *self.source_ids.entry(source.to_owned()).or_insert(next);
        for hit in &self.hits {
            self.seen_in.entry(hit.shingle).or_default().insert(source);
        }

        let mut hits = std::mem::take(&mut self.hits);
        for span in collapse(passage, &mut hits) {
            self.found.push((source, span.0, span.1));
        }
        self.hits = hits;
        true
    }

    /// The spans, with frequencies filled in, after the corpus has streamed.
    ///
    /// A source's overlapping chunks hold the same words twice, so where two
    /// spans from one source cover overlapping words of a sentence, only the
    /// longer is kept (ADR 006).
    pub fn finish(self) -> Vec<Span> {
        let Self { found, seen_in, .. } = self;

        let mut found = found;
        found.sort_by(|a, b| {
            (a.1.sentence, a.0)
                .cmp(&(b.1.sentence, b.0))
                .then(b.1.shared_words.cmp(&a.1.shared_words))
                .then(a.1.passage.cmp(&b.1.passage))
        });

        let mut kept: Vec<(u32, Span, Vec<u64>)> = Vec::new();
        for item in found {
            let overlaps = kept
                .iter()
                .rev()
                .take_while(|k| k.1.sentence == item.1.sentence && k.0 == item.0)
                .any(|k| {
                    k.1.sentence_words[0] < item.1.sentence_words[1]
                        && item.1.sentence_words[0] < k.1.sentence_words[1]
                });
            if !overlaps {
                kept.push(item);
            }
        }

        let mut spans: Vec<Span> = kept
            .into_iter()
            .map(|(_, mut span, grams)| {
                span.sources = grams
                    .iter()
                    .map(|g| seen_in.get(g).map_or(0, |s| s.len() as u32))
                    .collect();
                span
            })
            .collect();
        spans.sort_by_key(|s| (s.sentence, s.sentence_words[0], s.passage));
        spans
    }
}

/// One passage's hits → spans, one or more per sentence it shares words with.
///
/// Hits on the same diagonal (the same offset between sentence and passage)
/// with consecutive starts are a run of unbroken shared words. Runs close
/// enough together, in both texts, are one span.
fn collapse(passage: u32, hits: &mut [Hit]) -> Vec<(Span, Vec<u64>)> {
    hits.sort_by_key(|h| {
        (
            h.sentence,
            i64::from(h.at_passage) - i64::from(h.at_sentence),
            h.at_sentence,
        )
    });

    // Runs: (sentence, sentence start, sentence end, passage start, passage end, shingles)
    struct Run {
        sentence: u32,
        s: [u32; 2],
        p: [u32; 2],
        grams: Vec<u64>,
    }
    let mut runs: Vec<Run> = Vec::new();
    let shingle = SHINGLE as u32;
    for hit in hits.iter() {
        if let Some(run) = runs.last_mut() {
            let same_diagonal = run.sentence == hit.sentence
                && i64::from(run.p[0]) - i64::from(run.s[0])
                    == i64::from(hit.at_passage) - i64::from(hit.at_sentence);
            if same_diagonal && hit.at_sentence <= run.s[1] - shingle + 1 {
                run.s[1] = run.s[1].max(hit.at_sentence + shingle);
                run.p[1] = run.p[1].max(hit.at_passage + shingle);
                run.grams.push(hit.shingle);
                continue;
            }
        }
        runs.push(Run {
            sentence: hit.sentence,
            s: [hit.at_sentence, hit.at_sentence + shingle],
            p: [hit.at_passage, hit.at_passage + shingle],
            grams: vec![hit.shingle],
        });
    }

    runs.sort_by_key(|r| (r.sentence, r.s[0], r.p[0]));

    let mut spans: Vec<(Span, Vec<u64>, Vec<[u32; 2]>)> = Vec::new();
    for run in runs {
        if let Some((span, grams, covered)) = spans.last_mut() {
            let near = span.sentence == run.sentence
                && run.s[0] <= span.sentence_words[1] + MAX_GAP
                && run.p[0] + MAX_GAP >= span.passage_words[0]
                && run.p[0] <= span.passage_words[1] + MAX_GAP;
            if near {
                span.sentence_words[1] = span.sentence_words[1].max(run.s[1]);
                span.passage_words[0] = span.passage_words[0].min(run.p[0]);
                span.passage_words[1] = span.passage_words[1].max(run.p[1]);
                grams.extend(run.grams);
                covered.push(run.s);
                continue;
            }
        }
        spans.push((
            Span {
                sentence: run.sentence,
                passage,
                sentence_words: run.s,
                passage_words: run.p,
                shared_words: 0,
                verbatim_score: 0.0,
                sources: Vec::new(),
            },
            run.grams,
            vec![run.s],
        ));
    }

    spans
        .into_iter()
        .map(|(mut span, mut grams, covered)| {
            let [start, end] = span.sentence_words;
            let shared = (start..end)
                .filter(|w| covered.iter().any(|c| c[0] <= *w && *w < c[1]))
                .count() as u32;
            span.shared_words = shared;
            span.verbatim_score = shared as f32 / (end - start) as f32;
            grams.sort_unstable();
            grams.dedup();
            (span, grams)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(sentences: &[&str], passages: &[(&str, &str)]) -> Vec<Span> {
        let mut matcher = Matcher::new(sentences);
        for (i, (source, text)) in passages.iter().enumerate() {
            matcher.feed(i as u32, source, text);
        }
        matcher.finish()
    }

    const ORIGINAL: &str = "We propose a new simple network architecture, the Transformer, based \
        solely on attention mechanisms, dispensing with recurrence and convolutions entirely.";

    // M4-3 AC-2
    #[test]
    fn finds_a_sentence_copied_from_a_passage() {
        let spans = check(
            &["Unrelated opening words here.", "They proposed a new simple network architecture, the Transformer, based solely on attention mechanisms."],
            &[("paper-a", ORIGINAL), ("paper-b", "Nothing in common with the manuscript at all, at all.")],
        );

        assert_eq!(spans.len(), 1);
        let span = &spans[0];
        assert_eq!((span.sentence, span.passage), (1, 0));
        // "a new simple … mechanisms" is words 2..14 of the sentence.
        assert_eq!(span.sentence_words, [2, 14]);
        assert_eq!(span.passage_words, [2, 14]);
        assert_eq!(span.shared_words, 12);
        assert_eq!(span.verbatim_score, 1.0);
    }

    // M4-3 AC-2
    #[test]
    fn matches_across_ligatures_case_and_line_breaks() {
        let spans = check(
            &["THE ﬁnal net- works were trained on eight GPUs for twelve hours"],
            &[(
                "paper-a",
                "the final networks were trained on eight gpus for twelve hours",
            )],
        );
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].verbatim_score, 1.0);
    }

    // M4-3 AC-2
    #[test]
    fn counts_frequency_by_source_and_only_for_shingles_that_hit() {
        let stock = "in recent years there has been growing interest";
        let mut matcher = Matcher::new(&[stock]);
        for (i, source) in ["a", "b", "c"].iter().enumerate() {
            matcher.feed(i as u32, source, stock);
        }
        // A second chunk of "c" is the same source, not a fourth.
        matcher.feed(3, "c", &format!("{stock} once more"));
        matcher.feed(
            4,
            "d",
            "words that share nothing with the manuscript sentence above",
        );
        let spans = matcher.finish();

        assert_eq!(
            spans.len(),
            3,
            "one per source, the overlapping chunk deduplicated"
        );
        for span in &spans {
            assert!(span.sources.iter().all(|&n| n == 3), "{:?}", span.sources);
        }
        // Only the shingles that hit were counted, so nothing from "d".
        assert_eq!(spans[0].sources.len(), 3);
    }

    // M4-3 AC-3
    #[test]
    fn collapses_runs_either_side_of_a_changed_word_into_one_span() {
        let quoted = "superior in quality while being more parallelizable and requiring \
                      significantly less time to train than any model before them";
        let drifted = "superior in quality while being more parallelizable and requiring \
                       far less time to train than any model before them";
        let spans = check(&[drifted], &[("paper-a", quoted)]);

        assert_eq!(spans.len(), 1);
        let span = &spans[0];
        assert_eq!(span.sentence_words, [0, 19]);
        assert_eq!(span.shared_words, 18, "every word but the changed one");
        assert!(span.verbatim_score < 1.0 && span.verbatim_score > 0.9);
    }

    // M4-3 AC-3
    #[test]
    fn keeps_one_span_where_overlapping_chunks_repeat_the_words() {
        // Chunks overlap by 15%, so a sentence at a boundary is in both.
        let first = format!("Earlier text of the first chunk. {ORIGINAL}");
        let second = format!("{ORIGINAL} Later text of the second chunk.");
        let spans = check(&[ORIGINAL], &[("paper-a", &first), ("paper-a", &second)]);

        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].shared_words, 20);
    }

    // M4-3 AC-3
    #[test]
    fn keeps_a_span_per_source_when_two_works_share_the_words() {
        let spans = check(&[ORIGINAL], &[("paper-a", ORIGINAL), ("paper-b", ORIGINAL)]);
        assert_eq!(spans.len(), 2);
        assert_eq!(spans[0].passage, 0);
        assert_eq!(spans[1].passage, 1);
    }

    // M4-3 AC-2
    #[test]
    fn finds_nothing_in_sentences_shorter_than_a_shingle() {
        let matcher = Matcher::new(&["Too short to match."]);
        assert!(matcher.is_empty());
    }

    // M4-3 AC-2
    #[test]
    fn says_whether_a_passage_hit() {
        let mut matcher = Matcher::new(&[ORIGINAL]);
        assert!(matcher.feed(0, "a", ORIGINAL));
        assert!(!matcher.feed(1, "b", "nothing shared with the sentence in any six words"));
    }

    // M4-3 AC-3
    #[test]
    fn keeps_two_separate_borrowings_in_one_sentence_apart() {
        let sentence = "the encoder maps an input sequence of symbol representations and \
                        then for a long while we talk about something else entirely before \
                        the decoder then generates an output sequence of symbols";
        let passage = "the encoder maps an input sequence of symbol representations to a \
                       sequence of continuous representations given z the decoder then \
                       generates an output sequence of symbols one element at a time";
        let spans = check(&[sentence], &[("paper-a", passage)]);
        assert_eq!(spans.len(), 2, "{spans:?}");
    }
}
