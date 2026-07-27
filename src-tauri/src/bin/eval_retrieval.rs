//! Stage 2 of the retrieval benchmark: chunks + labelled queries -> Recall@K, MRR, throughput.
//!
//! Uses the same `ort` session, tokenizer and pooling as the shipped app, so the
//! numbers reflect what users actually get rather than a reimplementation.
//!
//! Run stage 1 first:
//!   ./scripts/fetch-retrieval-corpus.sh
//!   node scripts/eval/extract-chunks.mjs
//!   cargo run --release --bin eval_retrieval -- [--no-special-tokens] [--batch N]

use erti_lib::commands::{cosine_similarity, embed_texts};
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
}

#[derive(Deserialize)]
struct QueryFile {
    queries: Vec<Query>,
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

    let (mut hits_at_1, mut hits_at_5, mut hits_at_10, mut rr_total) =
        (0usize, 0usize, 0usize, 0f64);
    let mut misses: Vec<(&str, String, usize)> = Vec::new();

    for (qi, q) in qf.queries.iter().enumerate() {
        let mut scored: Vec<(f32, &str)> = corpus
            .iter()
            .enumerate()
            .map(|(ci, emb)| {
                (
                    cosine_similarity(&q_embeds[qi], emb),
                    cf.chunks[ci].source.as_str(),
                )
            })
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        // Rank of the gold *source*, by its best-scoring chunk.
        let mut seen: Vec<&str> = Vec::new();
        for (_, src) in &scored {
            if !seen.contains(src) {
                seen.push(src);
            }
            if seen.len() >= 10 {
                break;
            }
        }
        let rank = seen.iter().position(|s| *s == q.gold.as_str());

        match rank {
            Some(0) => {
                hits_at_1 += 1;
                hits_at_5 += 1;
                hits_at_10 += 1;
                rr_total += 1.0;
            }
            Some(r) if r < 5 => {
                hits_at_5 += 1;
                hits_at_10 += 1;
                rr_total += 1.0 / (r + 1) as f64;
            }
            Some(r) if r < 10 => {
                hits_at_10 += 1;
                rr_total += 1.0 / (r + 1) as f64;
            }
            _ => {}
        }

        if rank.map(|r| r > 0).unwrap_or(true) {
            misses.push((
                q.gold.as_str(),
                q.query.chars().take(70).collect(),
                rank.map(|r| r + 1).unwrap_or(0),
            ));
        }
    }

    let n = qf.queries.len() as f64;
    println!("query embed     : {query_ms:.0} ms/query\n");
    println!("queries         : {}", qf.queries.len());
    println!("Recall@1        : {:.1}%", 100.0 * hits_at_1 as f64 / n);
    println!("Recall@5        : {:.1}%", 100.0 * hits_at_5 as f64 / n);
    println!("Recall@10       : {:.1}%", 100.0 * hits_at_10 as f64 / n);
    println!("MRR             : {:.3}", rr_total / n);

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

    Ok(())
}
