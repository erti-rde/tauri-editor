//! The attribution check's matcher, for the harness (M4-1, M4-3, ADR 006).
//!
//! Two jobs:
//!
//! **Match**, which `pnpm eval:attribution` runs. It reads the labelled
//! sentences and the passages the harness assembled, runs the app's own
//! matcher over them, and writes the spans with every text's normalised words.
//! The harness checks the TypeScript normaliser gives the same words on the
//! real extracted text, then classifies.
//!
//!   cargo run --release --bin eval_attribution -- match <input.json> <output.json>
//!
//! **Bench** (M4-3 AC-4): a 10,000-word manuscript over 56,000 chunks, through
//! the command and a library on disk, as the app runs it. The chunks are the
//! retrieval corpus's, ten times over as ten libraries' worth of distinct
//! sources. The manuscript is the labelled sentences plus the corpus's own words
//! shuffled into sentences, which share almost no six-word run with anything.
//! The result is written to `tests/fixtures/attribution/speed.json`.
//!
//!   cargo run --release --bin eval_attribution -- bench

use erti_lib::attribution::{normalise::words, Matcher, Span};
use erti_lib::db::{queries, DbState};
use erti_lib::db_commands::check_attribution_in;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(Deserialize)]
struct Passage {
    source: String,
    text: String,
}

#[derive(Deserialize)]
struct Input {
    sentences: Vec<String>,
    passages: Vec<Passage>,
}

#[derive(Serialize)]
struct Words {
    sentences: Vec<Vec<String>>,
    passages: Vec<Vec<String>>,
}

#[derive(Serialize)]
struct Output {
    spans: Vec<Span>,
    ms: f64,
    words: Words,
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}

fn run_match(input: &Path, output: &Path) -> Result<(), String> {
    let input: Input = read_json(input)?;

    let started = Instant::now();
    let mut matcher = Matcher::new(&input.sentences);
    for (i, passage) in input.passages.iter().enumerate() {
        matcher.feed(i as u32, &passage.source, &passage.text);
    }
    let spans = matcher.finish();
    let ms = started.elapsed().as_secs_f64() * 1000.0;

    let out = Output {
        spans,
        ms,
        words: Words {
            sentences: input.sentences.iter().map(|s| words(s)).collect(),
            passages: input.passages.iter().map(|p| words(&p.text)).collect(),
        },
    };
    std::fs::write(
        output,
        serde_json::to_string(&out).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("{}: {e}", output.display()))
}

#[derive(Deserialize)]
struct Chunk {
    source: String,
    text: String,
}

#[derive(Deserialize)]
struct ChunkFile {
    chunks: Vec<Chunk>,
}

#[derive(Deserialize)]
struct Labelled {
    text: String,
}

#[derive(Deserialize)]
struct Fixture {
    sentences: Vec<Labelled>,
}

#[derive(Serialize)]
struct Speed {
    measured: String,
    machine: String,
    manuscript_words: usize,
    sentences: usize,
    chunks: usize,
    passages_read: u32,
    spans: usize,
    /// What crosses to the webview: the passages a span names, each with its
    /// text, and the whole result as the IPC layer serialises it.
    passages_returned: usize,
    response_bytes: usize,
    runs: usize,
    median_ms: f64,
    slowest_ms: f64,
    budget_ms: f64,
}

/// The same shuffle on every machine.
fn xorshift(seed: &mut u64) -> u64 {
    *seed ^= *seed << 13;
    *seed ^= *seed >> 7;
    *seed ^= *seed << 17;
    *seed
}

fn today() -> String {
    let out = std::process::Command::new("date")
        .arg("+%Y-%m-%d")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_default();
    out.trim().to_owned()
}

fn machine() -> String {
    let cpu = std::process::Command::new("sysctl")
        .args(["-n", "machdep.cpu.brand_string"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| std::env::consts::ARCH.to_owned());
    format!("{cpu}, {}", std::env::consts::OS)
}

async fn bench(root: &Path) -> Result<Speed, String> {
    const COPIES: usize = 10;
    const MANUSCRIPT_WORDS: usize = 10_000;
    const RUNS: usize = 5;

    let chunks: ChunkFile = read_json(&root.join("tests/fixtures/retrieval/chunks.json"))?;
    let fixture: Fixture = read_json(&root.join("tests/fixtures/attribution/sentences.json"))?;

    // The manuscript: every labelled sentence, then the corpus's words in a
    // shuffled order, twenty to a sentence, up to 10,000 words.
    let mut sentences: Vec<String> = fixture.sentences.into_iter().map(|s| s.text).collect();
    let mut count: usize = sentences.iter().map(|s| words(s).len()).sum();
    let mut pool: Vec<String> = chunks
        .chunks
        .iter()
        .flat_map(|c| {
            c.text
                .split_whitespace()
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .collect();
    let mut seed: u64 = 0x5eed_a77e_2026_0001;
    for i in (1..pool.len()).rev() {
        pool.swap(i, (xorshift(&mut seed) % (i as u64 + 1)) as usize);
    }
    let mut filler = pool.chunks(20);
    while count < MANUSCRIPT_WORDS {
        let Some(words_20) = filler.next() else { break };
        let sentence = format!("{}.", words_20.join(" "));
        count += words(&sentence).len();
        sentences.push(sentence);
    }

    // The library: the corpus ten times, each copy its own sources.
    let dir = std::env::temp_dir().join(format!("erti-bench-attribution-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await?;
    state.open_project(&dir.join("project")).await?;
    let library = state.library().await.map_err(|e| e.message)?;

    let mut by_source: std::collections::BTreeMap<&str, Vec<&str>> = Default::default();
    for chunk in &chunks.chunks {
        by_source
            .entry(&chunk.source)
            .or_default()
            .push(&chunk.text);
    }
    let mut stored = 0;
    for copy in 0..COPIES {
        for (source, texts) in &by_source {
            let sha = format!("{:x}", Sha256::digest(format!("{copy}:{source}")));
            queries::register_source(&library, &sha, &format!("/bench/{sha}.pdf"), "bench.pdf")
                .await?;
            let rows: Vec<queries::NewChunk> = texts
                .iter()
                .enumerate()
                .map(|(i, text)| queries::NewChunk {
                    text: (*text).to_owned(),
                    embedding: vec![0.0],
                    page_start: Some(i as i64 / 4 + 1),
                    page_end: Some(i as i64 / 4 + 1),
                    section: None,
                    char_start: None,
                    char_end: None,
                })
                .collect();
            queries::store_chunks(&library, &sha, &rows).await?;
            stored += rows.len();
        }
    }
    eprintln!(
        "library: {stored} chunks; manuscript: {count} words in {} sentences",
        sentences.len()
    );

    let mut times = Vec::new();
    let mut last = None;
    for _ in 0..RUNS {
        let started = Instant::now();
        let found = check_attribution_in(&state, None, sentences.clone())
            .await
            .map_err(|e| e.message)?;
        times.push(started.elapsed().as_secs_f64() * 1000.0);
        last = Some(found);
    }
    let found = last.expect("at least one run");
    times.sort_by(f64::total_cmp);
    let _ = std::fs::remove_dir_all(&dir);

    Ok(Speed {
        measured: today(),
        machine: machine(),
        manuscript_words: count,
        sentences: sentences.len(),
        chunks: stored,
        passages_read: found.read,
        spans: found.spans.len(),
        passages_returned: found.passages.len(),
        response_bytes: serde_json::to_vec(&found).map_err(|e| e.to_string())?.len(),
        runs: RUNS,
        median_ms: (times[RUNS / 2] * 10.0).round() / 10.0,
        slowest_ms: (times[RUNS - 1] * 10.0).round() / 10.0,
        budget_ms: 1000.0,
    })
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");

    match args.first().map(String::as_str) {
        Some("match") if args.len() == 3 => {
            run_match(Path::new(&args[1]), Path::new(&args[2]))?;
        }
        Some("bench") => {
            let speed = tokio::runtime::Runtime::new()?.block_on(bench(&root))?;
            let json = serde_json::to_string_pretty(&speed)?;
            println!("{json}");
            std::fs::write(
                root.join("tests/fixtures/attribution/speed.json"),
                format!("{json}\n"),
            )?;
            if speed.median_ms >= speed.budget_ms {
                return Err(format!("over budget: {} ms", speed.median_ms).into());
            }
        }
        _ => {
            return Err("usage: eval_attribution match <input.json> <output.json> | bench".into());
        }
    }
    Ok(())
}
