//! The retrieval index's budget, measured (M2-4, ADR 005).
//!
//! ADR 005 set a budget for the 1.0 target of 200 papers, about 56,000 rows: a
//! single-paragraph query under 50 ms, a build under 2 s, and about 86 MB
//! resident. This generates that library, the same one from the same seed on
//! every machine, writes it through the app's own writers into a fresh library
//! on disk, and measures each of the three.
//!
//! The vectors are synthetic. Brute force scores every row the filter lets
//! through whatever is in it, so the time and memory don't depend on what the
//! vectors mean, only on how many there are and how wide.
//!
//! Run with:
//!   cargo run --release --bin bench_index
//!   cargo run --release --bin bench_index -- --queries 1000
//!
//! The paragraph is embedded with the model in `src-tauri/resources` too, when
//! it's there, since the companion pays for that on every query as well.

use erti_lib::db::index::{Filter, HitKind, Index, Key};
use erti_lib::db::{queries, DbState};
use erti_lib::db_commands::{search_library_in, store_chunks_in};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// What the library is made from. Changing any of these changes the library,
/// and `FINGERPRINT` with it.
const SEED: u64 = 0x00E2_7140_0056_0000;
const DIMS: usize = 384;
/// 200 papers of 270 passages: the measured corpus has 5,601 for 20 papers.
const FILES: usize = 200;
const CHUNKS_PER_FILE: usize = 270;
const MARKS: usize = 1_500;
const NOTES: usize = 500;
/// The open project's share of the library.
const PROJECT: usize = 30;
const ROWS: usize = FILES * CHUNKS_PER_FILE + MARKS + NOTES;

/// sha256 over everything `generate` makes, in order. A library generated
/// anywhere else that hashes to this is the one measured here.
const FINGERPRINT: &str = "b3ab4a4880995b377b8f8295a98f5a5ca5ce447f0ccbc8dd7bdcf2f2b2fcdd4a";

/// splitmix64: small, and the same sequence on every platform. Only integer
/// arithmetic and exact float operations follow from it, never a libm call
/// whose last bit may differ between systems.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    /// In [0, 1), from 24 bits, so exactly representable.
    fn unit(&mut self) -> f32 {
        (self.next() >> 40) as f32 / (1u32 << 24) as f32
    }

    /// Roughly normal, centred on 0: a sum of four uniforms.
    fn spread(&mut self) -> f32 {
        (0..4).map(|_| self.unit()).sum::<f32>() - 2.0
    }

    /// Near `centre`, as a passage is near the rest of its paper.
    fn near(&mut self, centre: &[f32]) -> Vec<f32> {
        centre.iter().map(|c| c + self.spread()).collect()
    }

    fn words(&mut self, n: usize) -> String {
        (0..n)
            .map(|_| WORDS[self.below(WORDS.len())])
            .collect::<Vec<_>>()
            .join(" ")
    }
}

const WORDS: &[&str] = &[
    "the",
    "of",
    "and",
    "in",
    "model",
    "results",
    "we",
    "data",
    "analysis",
    "effect",
    "study",
    "method",
    "evidence",
    "participants",
    "significant",
    "between",
    "across",
    "measured",
    "retrieval",
    "approach",
    "suggests",
    "however",
    "previous",
    "work",
    "findings",
    "show",
    "that",
    "this",
    "is",
    "a",
    "to",
    "with",
    "for",
    "on",
    "as",
    "by",
    "were",
    "was",
    "are",
    "learning",
    "dense",
    "passage",
    "training",
    "language",
    "representation",
    "query",
    "performance",
    "baseline",
    "compared",
    "higher",
    "lower",
    "than",
    "under",
    "conditions",
    "argue",
    "theory",
    "framework",
    "historical",
    "sources",
    "interpretation",
    "claim",
    "argument",
    "context",
    "particular",
];

struct File {
    sha256: String,
    centre: Vec<f32>,
    /// Text about as long as a chunk at the 380-character target, and its vector.
    chunks: Vec<(String, Vec<f32>)>,
}

struct Mark {
    id: String,
    file: usize,
    quote: String,
    note: String,
    embedding: Vec<f32>,
}

struct Note {
    id: String,
    file: usize,
    body: String,
    embedding: Vec<f32>,
}

struct Library {
    files: Vec<File>,
    marks: Vec<Mark>,
    notes: Vec<Note>,
}

impl Library {
    fn rows(&self) -> usize {
        self.files.iter().map(|f| f.chunks.len()).sum::<usize>()
            + self.marks.len()
            + self.notes.len()
    }

    /// Every id, text and vector byte, in the order generated.
    fn fingerprint(&self) -> String {
        let mut h = Sha256::new();
        let mut vector = |v: &[f32]| v.iter().for_each(|x| h.update(x.to_le_bytes()));
        for f in &self.files {
            vector(&f.centre);
            for (_, v) in &f.chunks {
                vector(v);
            }
        }
        for m in &self.marks {
            vector(&m.embedding);
        }
        for n in &self.notes {
            vector(&n.embedding);
        }
        for f in &self.files {
            h.update(f.sha256.as_bytes());
            for (text, _) in &f.chunks {
                h.update(text.as_bytes());
            }
        }
        for m in &self.marks {
            h.update(format!("{}{}{}{}", m.id, m.file, m.quote, m.note).as_bytes());
        }
        for n in &self.notes {
            h.update(format!("{}{}{}", n.id, n.file, n.body).as_bytes());
        }
        format!("{:x}", h.finalize())
    }
}

fn generate(seed: u64) -> Library {
    let mut rng = Rng(seed);
    let files: Vec<File> = (0..FILES)
        .map(|i| {
            let sha256 = format!("{:x}", Sha256::digest(format!("synthetic {seed} {i}")));
            let centre: Vec<f32> = (0..DIMS).map(|_| rng.spread()).collect();
            let chunks = (0..CHUNKS_PER_FILE)
                .map(|_| (rng.words(55), rng.near(&centre)))
                .collect();
            File {
                sha256,
                centre,
                chunks,
            }
        })
        .collect();
    let marks = (0..MARKS)
        .map(|i| {
            let file = rng.below(FILES);
            Mark {
                id: format!("mark-{i:04}"),
                file,
                quote: rng.words(12),
                note: rng.words(8),
                embedding: rng.near(&files[file].centre),
            }
        })
        .collect();
    let notes = (0..NOTES)
        .map(|i| {
            let file = rng.below(FILES);
            Note {
                id: format!("note-{i:04}"),
                file,
                body: rng.words(30),
                embedding: rng.near(&files[file].centre),
            }
        })
        .collect();
    Library {
        files,
        marks,
        notes,
    }
}

/// Paragraphs to query with: each near one paper, as a paragraph about it is,
/// and long enough to fill the model's 128 tokens.
fn paragraphs(library: &Library, n: usize) -> Vec<(String, Vec<f32>)> {
    let mut rng = Rng(SEED ^ 0xFFFF);
    (0..n)
        .map(|_| {
            let file = &library.files[rng.below(FILES)];
            (rng.words(150), rng.near(&file.centre))
        })
        .collect()
}

/// Write the library through the app's own writers, into a fresh library and
/// project under `dir`.
async fn write(library: &Library, dir: &Path) -> Result<DbState, String> {
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await?;
    state.open_project(&dir.join("project")).await?;
    let pool = state.library().await.map_err(|e| e.message)?;
    let project = state.project().await.map_err(|e| e.message)?;
    queries::set_embedding_meta(&pool, "synthetic", DIMS as i64).await?;

    for (i, file) in library.files.iter().enumerate() {
        let name = format!("paper-{i:03}.pdf");
        queries::register_source(&pool, &file.sha256, &format!("/synthetic/{name}"), &name).await?;
        let chunks: Vec<queries::NewChunk> = file
            .chunks
            .iter()
            .enumerate()
            .map(|(j, (text, embedding))| queries::NewChunk {
                text: text.clone(),
                embedding: embedding.clone(),
                page_start: Some(1 + j as i64 / 9),
                page_end: None,
                section: None,
                char_start: None,
                char_end: None,
            })
            .collect();
        store_chunks_in(&state, &file.sha256, &chunks)
            .await
            .map_err(|e| e.message)?;
        if i < PROJECT {
            queries::add_to_project(&project, &file.sha256).await?;
        }
    }

    for mark in &library.marks {
        let sha256 = &library.files[mark.file].sha256;
        queries::save_annotation(
            &pool,
            &queries::NewAnnotation {
                id: mark.id.clone(),
                sha256: sha256.clone(),
                kind: "highlight".into(),
                label_id: None,
                page: 1,
                rects: None,
                quote: Some(mark.quote.clone()),
                prefix: None,
                suffix: None,
                char_start: None,
                char_end: None,
                note: Some(mark.note.clone()),
                style: None,
                page_label: None,
                origin: None,
            },
        )
        .await?;
        queries::save_annotation_embedding(&pool, &mark.id, &mark.embedding, "synthetic").await?;
    }

    for note in &library.notes {
        // A paper registered by its file is its own work, so a note on the
        // work is under the file's hash.
        let sha256 = library.files[note.file].sha256.clone();
        queries::save_source_note(
            &pool,
            &queries::NewSourceNote {
                id: note.id.clone(),
                sha256,
                body: note.body.clone(),
                quote: None,
                page_label: None,
                label_id: None,
            },
        )
        .await?;
        let to_embed = queries::NoteToEmbed {
            id: note.id.clone(),
            body: note.body.clone(),
            quote: None,
            text: note.body.clone(),
            hash: "synthetic".into(),
        };
        queries::save_source_note_embedding(&pool, &to_embed, &note.embedding).await?;
    }

    // Some rows went in below the writers that keep the index current.
    state.invalidate_index();
    Ok(state)
}

/// This process's memory, in MB: the resident set as `ps` reports it, and on
/// macOS the physical footprint and its peak, as `vmmap` does. The footprint
/// is what Activity Monitor shows; the resident set also counts pages the
/// allocator has freed and the system hasn't taken back yet.
struct Memory {
    resident: f64,
    footprint: Option<(f64, f64)>,
}

fn memory() -> Memory {
    let pid = std::process::id().to_string();
    let out = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &pid])
        .output()
        .expect("ps");
    let kb: f64 = String::from_utf8_lossy(&out.stdout).trim().parse().unwrap();

    // "Physical footprint:         216.6M", and the same "(peak)".
    let footprint = std::process::Command::new("vmmap")
        .args(["--summary", &pid])
        .output()
        .ok()
        .and_then(|out| {
            let text = String::from_utf8_lossy(&out.stdout).into_owned();
            let field = |name: &str| {
                let value = text.lines().find_map(|l| l.strip_prefix(name))?.trim();
                let (n, unit) = value.split_at(value.len() - 1);
                let n: f64 = n.parse().ok()?;
                Some(match unit {
                    "K" => n / 1024.0,
                    "M" => n,
                    "G" => n * 1024.0,
                    _ => return None,
                })
            };
            Some((
                field("Physical footprint:")?,
                field("Physical footprint (peak):")?,
            ))
        });
    Memory {
        resident: kb / 1024.0,
        footprint,
    }
}

impl std::fmt::Display for Memory {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "{:>8.1}", self.resident)?;
        match self.footprint {
            Some((now, peak)) => write!(f, " {now:>9.1} {peak:>8.1}"),
            None => Ok(()),
        }
    }
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

/// p50 and p95 of `times`, in milliseconds, nearest-rank.
fn percentiles(mut times: Vec<Duration>) -> (f64, f64, f64) {
    times.sort();
    let at = |p: f64| {
        let rank = ((p * times.len() as f64).ceil() as usize).clamp(1, times.len());
        ms(times[rank - 1])
    };
    (at(0.50), at(0.95), ms(*times.last().unwrap()))
}

fn report(name: &str, times: Vec<Duration>) {
    let (p50, p95, max) = percentiles(times);
    println!("  {name:<38} {p50:>8.2} {p95:>8.2} {max:>8.2}");
}

fn opt(name: &str, default: usize) -> usize {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == &format!("--{name}"))
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn machine() -> String {
    let run = |cmd: &str, args: &[&str]| {
        std::process::Command::new(cmd)
            .args(args)
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
    };
    let cpu = run("sysctl", &["-n", "machdep.cpu.brand_string"])
        .or_else(|| run("uname", &["-m"]))
        .unwrap_or_else(|| "unknown".into());
    format!("{cpu}, {} {}", std::env::consts::OS, std::env::consts::ARCH)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let rt = tokio::runtime::Runtime::new()?;
    let builds = opt("builds", 10).max(1);
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--measure") {
        let dir = PathBuf::from(&args[i + 1]);
        return rt.block_on(measure(&dir, builds));
    }

    let dir = std::env::temp_dir().join(format!("erti-bench-index-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir)?;
    let result = rt
        .block_on(prepare(&dir, opt("queries", 500).max(1)))
        .and_then(|()| {
            // Measured in a process of its own, so the memory it reports, and its
            // peak, are the index's and not the generator's.
            let status = std::process::Command::new(std::env::current_exe()?)
                .args(["--measure", dir.to_str().unwrap()])
                .args(["--builds", &builds.to_string()])
                .status()?;
            if status.success() {
                Ok(())
            } else {
                Err(format!("measuring failed: {status}").into())
            }
        });
    let _ = std::fs::remove_dir_all(&dir);
    result
}

/// Generate the library and write it under `dir`, with the paragraphs to
/// query it with.
async fn prepare(dir: &Path, n_queries: usize) -> Result<(), Box<dyn std::error::Error>> {
    println!("machine   : {}", machine());

    let started = Instant::now();
    let library = generate(SEED);
    let fingerprint = library.fingerprint();
    println!(
        "library   : {} rows ({FILES} files × {CHUNKS_PER_FILE} passages, {MARKS} marks, {NOTES} source notes), {DIMS} wide",
        library.rows()
    );
    println!("            {PROJECT} files in the open project");
    println!("seed      : {SEED:#018x}");
    println!("generated : {fingerprint}");
    if fingerprint != FINGERPRINT {
        println!("            (not the library BUDGET.md measured)");
    }
    println!("            in {:.1} s", started.elapsed().as_secs_f64());

    let started = Instant::now();
    let state = write(&library, dir).await?;
    state.library().await?.close().await;
    state.project().await?.close().await;
    let on_disk = std::fs::metadata(dir.join("library.db"))?.len() as f64 / 1e6;
    println!(
        "written   : {on_disk:.0} MB on disk, in {:.1} s",
        started.elapsed().as_secs_f64()
    );
    let paragraphs = paragraphs(&library, n_queries);
    std::fs::write(
        dir.join("paragraphs.json"),
        serde_json::to_vec(&paragraphs)?,
    )?;
    Ok(())
}

/// Measure the library `prepare` wrote under `dir`.
async fn measure(dir: &Path, builds: usize) -> Result<(), Box<dyn std::error::Error>> {
    let paragraphs: Vec<(String, Vec<f32>)> =
        serde_json::from_slice(&std::fs::read(dir.join("paragraphs.json"))?)?;
    let n_queries = paragraphs.len();
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await?;
    state.open_project(&dir.join("project")).await?;
    let pool = state.library().await?;

    // --- memory -----------------------------------------------------------------
    // First, before this process has built an index, so nothing an earlier
    // build left behind is counted. The same two steps as the app's
    // build (`index::load`), one at a time, to see what each holds.
    let before = memory();
    let meta = queries::embedding_meta(&pool).await?;
    let rows = queries::index_rows(&pool).await?;
    let read = memory();
    let index = Index::build(rows, meta.map(|(m, _)| m), Some(DIMS));
    let held = memory();
    assert_eq!(index.len(), ROWS);
    drop(index);
    let dropped = memory();

    // What the index holds, counted: the matrix, and per row its key (a
    // passage's key owns its file's hash), owner and width.
    let chunks = FILES * CHUNKS_PER_FILE;
    let matrix = ROWS * DIMS * 4;
    let per_row = ROWS * (std::mem::size_of::<Key>() + 4 + 8) + chunks * 64 + (MARKS + NOTES) * 9;
    let mb = |b: usize| b as f64 / (1024.0 * 1024.0);

    // --- build ------------------------------------------------------------------
    // The app's path: the first query after opening a library reads every
    // vector and packs them, on the blocking pool.
    let mut whole = Vec::new();
    for _ in 0..builds {
        state.invalidate_index();
        let started = Instant::now();
        let (_, index) = state.index().await?;
        whole.push(started.elapsed());
        drop(index);
    }
    let mut reads = Vec::new();
    let mut packs = Vec::new();
    for _ in 0..builds {
        let started = Instant::now();
        let meta = queries::embedding_meta(&pool).await?;
        let rows = queries::index_rows(&pool).await?;
        reads.push(started.elapsed());
        let started = Instant::now();
        let index = Index::build(rows, meta.map(|(m, _)| m), Some(DIMS));
        packs.push(started.elapsed());
        drop(index);
    }
    state.invalidate_index();
    let after_builds = memory();

    println!("\nbuild ({builds} runs)                              p50      p95      max   (ms)");
    report("read + pack, as a query after opening", whole);
    report("  read every vector from SQLite", reads);
    report("  normalise and pack", packs);

    println!("\nmemory (MB)                              resident footprint     peak");
    println!("  before the first build                 {before}");
    println!("  every vector read, not yet packed      {read}");
    println!("  packed: the index held                 {held}");
    println!("  index dropped                          {dropped}");
    println!(
        "  after {:<3} more builds, none held      {after_builds}",
        2 * builds
    );
    println!("\nthe index's own heap (MB, counted)");
    println!(
        "  matrix: {ROWS} rows × {DIMS} × 4 B        {:>8.1}",
        mb(matrix)
    );
    println!(
        "  keys, owners and widths                {:>8.1}",
        mb(per_row)
    );
    println!(
        "  total                                  {:>8.1}",
        mb(matrix + per_row)
    );

    // --- queries ----------------------------------------------------------------
    let (_, index) = state.index().await?;
    let project: Vec<String> = queries::project_source_hashes(&state.project().await?).await?;
    let aliases = queries::alias_map(&pool).await?;
    let in_project: HashSet<&str> = project
        .iter()
        .map(|id| queries::resolve(&aliases, id))
        .collect();

    // Warm the caches and the allocator, as a session that has been writing has.
    for (_, q) in paragraphs.iter().take(20) {
        search_library_in(&state, q, None, Some(20), Some(true)).await?;
    }

    let mut scan = Vec::new();
    let mut every = Vec::new();
    let mut notes = Vec::new();
    let mut passages = Vec::new();
    for (_, q) in &paragraphs {
        let filter = Filter {
            kinds: &[],
            project: &in_project,
            include_library: true,
            aliases: &aliases,
        };
        let started = Instant::now();
        let found = index.search(q, &filter, 20);
        scan.push(started.elapsed());
        assert_eq!(found.len(), 20);

        let started = Instant::now();
        let hits = search_library_in(&state, q, None, Some(20), Some(true)).await?;
        every.push(started.elapsed());
        assert_eq!(hits.len(), 20);

        let started = Instant::now();
        let kinds = vec![HitKind::Annotation, HitKind::SourceNote];
        search_library_in(&state, q, Some(kinds), Some(20), Some(true)).await?;
        notes.push(started.elapsed());

        let started = Instant::now();
        search_library_in(&state, q, Some(vec![HitKind::Chunk]), Some(5), Some(false)).await?;
        passages.push(started.elapsed());
    }

    println!(
        "\nquery ({n_queries} paragraphs)                          p50      p95      max   (ms)"
    );
    report("index only: score 56k rows, top 20", scan);
    report("every kind, whole library, top 20", every);
    report("marks and notes, whole library, top 20", notes);
    report("project passages, top 5", passages);

    // --- the paragraph itself ---------------------------------------------------
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let model = root.join("src-tauri/resources");
    if !model.join("all-MiniLM-L6-v2").exists() {
        println!(
            "\n(no model in {}: embedding not measured)",
            model.display()
        );
        return Ok(());
    }
    erti_lib::ml::initialize_ml_state(model.to_str().unwrap())
        .await
        .map_err(|e| format!("ML init failed: {e}"))?;
    // The first inference sets the session up.
    erti_lib::commands::embed_texts(&[paragraphs[0].0.clone()], true)?;

    let mut embeds = Vec::new();
    let mut whole = Vec::new();
    for (text, _) in &paragraphs {
        let started = Instant::now();
        let embedding = erti_lib::commands::embed_texts(std::slice::from_ref(text), true)?
            .pop()
            .unwrap();
        embeds.push(started.elapsed());
        search_library_in(&state, &embedding, None, Some(20), Some(true)).await?;
        whole.push(started.elapsed());
    }
    report("embed the paragraph (128 tokens)", embeds);
    report("paragraph to results (embed + search)", whole);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // M2-4 AC-1
    #[test]
    fn the_same_56k_row_library_is_generated_from_the_seed_on_any_machine() {
        let library = generate(SEED);
        assert_eq!(library.rows(), 56_000);
        assert_eq!(ROWS, 56_000);
        assert!(library
            .files
            .iter()
            .flat_map(|f| &f.chunks)
            .all(|(_, v)| v.len() == DIMS));
        // Pinned, not just compared with a second run: the same library on
        // every platform, so a measurement elsewhere is of this one.
        assert_eq!(library.fingerprint(), FINGERPRINT);
    }
}
