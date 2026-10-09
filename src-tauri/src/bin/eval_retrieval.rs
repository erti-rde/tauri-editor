//! Stage 2 of the retrieval benchmark: chunks + labelled queries -> Recall@K, MRR, throughput.
//!
//! Also scores the note-matching set (M2-3): a paragraph against the notes a
//! reader wrote, ranked by note rather than by source.
//!
//! Uses the same `ort` session, tokenizer and pooling as the shipped app, so the
//! numbers reflect what users actually get rather than a reimplementation.
//!
//! Run stage 1 first:
//!   ./scripts/fetch-retrieval-corpus.sh
//!   node scripts/eval/extract-chunks.mjs
//!   cargo run --release --bin eval_retrieval -- [--no-special-tokens] [--batch N]

use erti_lib::commands::{cosine_similarity, embed_texts};
use erti_lib::db::queries::source_note_text;
use erti_lib::ml;
use serde::Deserialize;
use std::time::Instant;

#[derive(Deserialize)]
struct Chunk {
    source: String,
    text: String,
}

#[derive(Deserialize)]
struct ChunkFile {
    params: serde_json::Value,
    chunks: Vec<Chunk>,
}

#[derive(Deserialize)]
struct Query {
    query: String,
    gold: String,
    /// "easy" or "hard". Absent in older files, which are all easy.
    #[serde(default)]
    difficulty: Option<String>,
}

/// Recall and MRR over one slice of the query set.
#[derive(Default)]
struct Scores {
    n: usize,
    at_1: usize,
    at_5: usize,
    at_10: usize,
    rr: f64,
}

impl Scores {
    fn record(&mut self, rank: Option<usize>) {
        self.n += 1;
        match rank {
            Some(0) => {
                self.at_1 += 1;
                self.at_5 += 1;
                self.at_10 += 1;
                self.rr += 1.0;
            }
            Some(r) if r < 5 => {
                self.at_5 += 1;
                self.at_10 += 1;
                self.rr += 1.0 / (r + 1) as f64;
            }
            Some(r) if r < 10 => {
                self.at_10 += 1;
                self.rr += 1.0 / (r + 1) as f64;
            }
            _ => {}
        }
    }

    fn report(&self, label: &str) {
        if self.n == 0 {
            return;
        }
        let n = self.n as f64;
        println!(
            "{:<16}{:>4}   {:>5.1}%  {:>5.1}%  {:>5.1}%   {:.3}",
            label,
            self.n,
            100.0 * self.at_1 as f64 / n,
            100.0 * self.at_5 as f64 / n,
            100.0 * self.at_10 as f64 / n,
            self.rr / n
        );
    }
}

/// A mark or a source note, embedded as the app embeds either: quote, then body.
#[derive(Deserialize)]
struct Note {
    id: String,
    #[serde(default)]
    quote: Option<String>,
    body: String,
}

#[derive(Deserialize)]
struct QueryFile {
    queries: Vec<Query>,
    #[serde(default)]
    notes: Vec<Note>,
    /// Paragraph -> note pairs; `gold` names a note, not a source.
    #[serde(default)]
    note_queries: Vec<Query>,
}

/// Where `gold` ranks among `candidates` by similarity to `query`, 0-based,
/// counting each candidate once by its best-scoring vector; `None` past 10.
fn rank_of<'a>(
    query: &[f32],
    vectors: &[Vec<f32>],
    owners: impl Fn(usize) -> &'a str,
    gold: &str,
) -> (Option<usize>, Vec<&'a str>) {
    let mut scored: Vec<(f32, &str)> = vectors
        .iter()
        .enumerate()
        .map(|(i, v)| (cosine_similarity(query, v), owners(i)))
        .collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let mut seen: Vec<&str> = Vec::new();
    for (_, owner) in &scored {
        if !seen.contains(owner) {
            seen.push(owner);
        }
        if seen.len() >= 10 {
            break;
        }
    }
    (seen.iter().position(|s| *s == gold), seen)
}

fn flag(name: &str) -> bool {
    std::env::args().any(|a| a == format!("--{name}"))
}

fn opt(name: &str, default: usize) -> usize {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == &format!("--{name}"))
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf();
    let fixtures = root.join("tests/fixtures/retrieval");

    let chunk_path = fixtures.join("chunks.json");
    if !chunk_path.exists() {
        eprintln!(
            "missing {}\nRun: node scripts/eval/extract-chunks.mjs",
            chunk_path.display()
        );
        std::process::exit(1);
    }

    let cf: ChunkFile = serde_json::from_slice(&std::fs::read(&chunk_path)?)?;
    let qf: QueryFile = serde_json::from_slice(&std::fs::read(fixtures.join("queries.json"))?)?;

    // sentence-transformers embeds with [CLS]/[SEP]; the app currently does not.
    let add_special_tokens = !flag("no-special-tokens");
    let batch = opt("batch", 64);
    if batch == 0 {
        // chunks(0) panics rather than erroring.
        return Err("--batch must be at least 1".into());
    }

    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(ml::initialize_ml_state(
        root.join("src-tauri/resources").to_str().unwrap(),
    ))
    .map_err(|e| format!("ML init failed: {e}"))?;

    println!("chunking params : {}", cf.params);
    println!("special tokens  : {add_special_tokens}");
    println!("batch size      : {batch}");
    println!(
        "corpus          : {} chunks over {} sources\n",
        cf.chunks.len(),
        cf.chunks
            .iter()
            .map(|c| &c.source)
            .collect::<std::collections::HashSet<_>>()
            .len()
    );

    // --- embed the corpus -----------------------------------------------------
    let started = Instant::now();
    let mut corpus: Vec<Vec<f32>> = Vec::with_capacity(cf.chunks.len());
    for group in cf.chunks.chunks(batch) {
        let texts: Vec<String> = group.iter().map(|c| c.text.clone()).collect();
        corpus.extend(embed_texts(&texts, add_special_tokens)?);
    }
    let embed_secs = started.elapsed().as_secs_f64();

    println!(
        "embedded {} chunks in {:.1}s  ({:.0} chunks/sec)",
        corpus.len(),
        embed_secs,
        corpus.len() as f64 / embed_secs
    );

    // --- score ----------------------------------------------------------------
    let queries: Vec<String> = qf.queries.iter().map(|q| q.query.clone()).collect();
    let q_started = Instant::now();
    let q_embeds = embed_texts(&queries, add_special_tokens)?;
    let query_ms = q_started.elapsed().as_secs_f64() * 1000.0 / queries.len().max(1) as f64;

    // Scored separately as well as together: the easy set saturated at 100%
    // Recall@5, so averaging the two would hide exactly the discrimination the
    // hard set was written to provide.
    let mut all = Scores::default();
    let mut easy = Scores::default();
    let mut hard = Scores::default();
    let mut misses: Vec<(&str, String, usize)> = Vec::new();
    // Per-query ranks, written out so two runs can be compared as a paired test.
    // Comparing two models by their headline percentages throws away the fact
    // that they saw the same queries, and with a set this size that is the
    // difference between detecting a real improvement and not.
    let mut per_query: Vec<serde_json::Value> = Vec::new();

    for (qi, q) in qf.queries.iter().enumerate() {
        // Rank of the gold *source*, by its best-scoring chunk.
        let (rank, _) = rank_of(
            &q_embeds[qi],
            &corpus,
            |ci| cf.chunks[ci].source.as_str(),
            &q.gold,
        );

        all.record(rank);
        match q.difficulty.as_deref() {
            Some("hard") => hard.record(rank),
            _ => easy.record(rank),
        }

        per_query.push(serde_json::json!({
            "query": q.query,
            "gold": q.gold,
            "difficulty": q.difficulty.as_deref().unwrap_or("easy"),
            // 0 means the gold source was outside the top 10.
            "rank": rank.map(|r| r + 1).unwrap_or(0),
        }));

        if rank.map(|r| r > 0).unwrap_or(true) {
            misses.push((
                q.gold.as_str(),
                q.query.chars().take(70).collect(),
                rank.map(|r| r + 1).unwrap_or(0),
            ));
        }
    }

    // --- note matching (M2-3) ------------------------------------------------
    // Ranked against the notes alone, as the Notes panel ranks Your notes: the
    // kinds filter applies before scoring (M2-1 AC-3), so passages never compete.
    let note_texts: Vec<String> = qf
        .notes
        .iter()
        .map(|n| source_note_text(n.quote.as_deref(), &n.body))
        .collect();
    let note_embeds = embed_texts(&note_texts, add_special_tokens)?;
    let paragraphs: Vec<String> = qf.note_queries.iter().map(|q| q.query.clone()).collect();
    let paragraph_embeds = embed_texts(&paragraphs, add_special_tokens)?;

    let mut notes = Scores::default();
    let mut per_note_query: Vec<serde_json::Value> = Vec::new();
    let mut note_misses: Vec<(&str, String, usize, &str)> = Vec::new();
    for (qi, q) in qf.note_queries.iter().enumerate() {
        let (rank, seen) = rank_of(
            &paragraph_embeds[qi],
            &note_embeds,
            |ni| qf.notes[ni].id.as_str(),
            &q.gold,
        );
        notes.record(rank);
        let top = seen.first().copied().unwrap_or("");
        per_note_query.push(serde_json::json!({
            "query": q.query,
            "gold": q.gold,
            "rank": rank.map(|r| r + 1).unwrap_or(0),
            "top": top,
        }));
        if rank != Some(0) {
            note_misses.push((
                q.gold.as_str(),
                q.query.chars().take(70).collect(),
                rank.map(|r| r + 1).unwrap_or(0),
                top,
            ));
        }
    }

    println!("query embed     : {query_ms:.0} ms/query\n");
    println!("set                 n      R@1     R@5    R@10   MRR");
    all.report("all");
    easy.report("  easy");
    hard.report("  hard");
    // Not part of "all": a different task over a different pool, so folding it
    // in would move the paper-retrieval numbers the baseline is compared on.
    notes.report("notes");
    if notes.n > 0 {
        println!(
            "  ({} paragraphs against {} notes)",
            notes.n,
            qf.notes.len()
        );
    }

    let out = fixtures.join("last-run.json");
    std::fs::write(
        &out,
        serde_json::to_vec_pretty(&serde_json::json!({
            "model": "all-MiniLM-L6-v2",
            "chunks": cf.chunks.len(),
            "queries": per_query,
            "note_queries": per_note_query,
        }))?,
    )?;
    println!("\nper-query ranks -> {}", out.display());

    if !misses.is_empty() {
        println!("\nnot ranked first ({}):", misses.len());
        for (gold, q, rank) in &misses {
            let where_ = if *rank == 0 {
                "outside top 10".to_string()
            } else {
                format!("rank {rank}")
            };
            println!("  {gold:<14} {where_:<14} {q}");
        }
    }

    if !note_misses.is_empty() {
        println!("\nnotes not ranked first ({}):", note_misses.len());
        for (gold, q, rank, top) in &note_misses {
            let where_ = if *rank == 0 {
                "outside top 10".to_string()
            } else {
                format!("rank {rank}, {top} first")
            };
            println!("  {gold:<5} {where_:<20} {q}");
        }
    }

    Ok(())
}
