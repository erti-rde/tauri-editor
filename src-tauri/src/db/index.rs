//! The retrieval index (ADR 005, M2-1).
//!
//! Every search by meaning used to read every vector out of SQLite, unpack it
//! and work out both norms again, on each query: about 86 MB at the 1.0 target
//! of 56,000 chunks, and the writing companion queries on every paragraph. This
//! holds the vectors in memory instead, once per open library, as one
//! contiguous row-major matrix of L2-normalised `f32`, so a score is a dot
//! product over memory that's already there.
//!
//! SQLite stays the source of truth. The index is built from it lazily, on the
//! first query, and dropped whenever something it holds may have changed, so it
//! can't drift and needs no migration of its own.
//!
//! What's in a result beyond its score (the passage's text, the mark, the note)
//! is read back from SQLite for the top few only. And a result's work is
//! resolved through the aliases at query time rather than stored here, so
//! merging two works never leaves the index holding the old answer.

use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use super::queries;

/// What a row of the index is.
///
/// Kept apart in a result, never blended: a passage from a paper is quotable,
/// a mark or a note is a judgement already made (see `search_annotations`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum HitKind {
    Chunk,
    Annotation,
    SourceNote,
}

/// The row a vector came from: the primary key of its table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Key {
    Chunk { sha256: String, idx: i64 },
    Annotation(String),
    SourceNote(String),
}

impl Key {
    pub fn kind(&self) -> HitKind {
        match self {
            Key::Chunk { .. } => HitKind::Chunk,
            Key::Annotation(_) => HitKind::Annotation,
            Key::SourceNote(_) => HitKind::SourceNote,
        }
    }
}

/// One vector as stored, with the file or work it belongs to.
pub struct Row {
    pub key: Key,
    /// The `sha256` column of the row: a file's hash for a chunk or a mark, the
    /// work's id for a source note. Resolved to a work when searched.
    pub owner: String,
    pub embedding: Vec<f32>,
}

/// What to search, decided before anything is scored.
pub struct Filter<'a> {
    /// Kinds to include. Empty means every kind.
    pub kinds: &'a [HitKind],
    /// The open project's works, already resolved (ADR 003).
    pub project: &'a HashSet<&'a str>,
    /// Whether rows outside the project count at all. Inside it they always
    /// rank first.
    pub include_library: bool,
    pub aliases: &'a HashMap<String, String>,
}

/// One row's score, pointing back at the row.
#[derive(Debug, Clone)]
pub struct Found<'a> {
    pub key: &'a Key,
    /// The work the row belongs to, resolved now.
    pub source_id: &'a str,
    pub similarity: f32,
    pub in_project: bool,
}

pub struct Index {
    dims: usize,
    /// `keys.len()` rows of `dims`, each of length 1 (or 0, see `build`).
    vectors: Vec<f32>,
    keys: Vec<Key>,
    /// Index into `owners`, per row. A library has a few hundred files and
    /// tens of thousands of rows, so whether a row is in the project is worked
    /// out once per file per query, not once per row.
    owner_of: Vec<u32>,
    owners: Vec<String>,
    /// The model the vectors came from (`embedding_meta`), so a change of
    /// model is noticed and the index rebuilt.
    model: Option<String>,
}

/// `v` scaled to length 1, in place. A zero vector stays zero: it has no
/// direction, and scores 0 against everything, as cosine similarity gave it.
fn normalise(v: &mut [f32]) {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        v.iter_mut().for_each(|x| *x /= norm);
    }
}

/// The width the index is built at: the current model's (`embedding_meta`)
/// when some row has it, else the width most rows have.
///
/// Not the first row's: after a change of model, a library can still hold
/// vectors from the last one, and rows come in no particular order. Taking an
/// old row's width zeroed every current one, so nothing ranked by meaning at
/// all. And nothing records a model yet, so the rows themselves have to say.
///
/// The recorded width counts only when a row has it, so a bad one can't size
/// a matrix that holds nothing: every row would be zeroed anyway.
fn width(rows: &[Row], recorded: Option<usize>) -> usize {
    if let Some(dims) = recorded.filter(|&d| rows.iter().any(|r| r.embedding.len() == d)) {
        return dims;
    }
    let mut counts: HashMap<usize, usize> = HashMap::new();
    for row in rows {
        *counts.entry(row.embedding.len()).or_default() += 1;
    }
    // Ties to the wider, so the same library always gets the same width.
    counts
        .into_iter()
        .max_by_key(|&(dims, count)| (count, dims))
        .map_or(0, |(dims, _)| dims)
}

impl Index {
    /// Normalise and pack rows into one matrix. CPU work, for `spawn_blocking`.
    ///
    /// A row of another width came from another model; it's kept, as a zero
    /// vector, so it's still found by a filter and scores 0, which is what
    /// comparing vectors of different lengths gave.
    pub fn build(rows: Vec<Row>, model: Option<String>, dims: Option<usize>) -> Index {
        let dims = width(&rows, dims);
        let mut vectors = Vec::with_capacity(rows.len() * dims);
        let mut keys = Vec::with_capacity(rows.len());
        let mut owner_of = Vec::with_capacity(rows.len());
        let mut owners: Vec<String> = Vec::new();
        let mut owner_ix: HashMap<String, u32> = HashMap::new();

        for row in rows {
            let start = vectors.len();
            if row.embedding.len() == dims {
                vectors.extend_from_slice(&row.embedding);
                normalise(&mut vectors[start..]);
            } else {
                vectors.resize(start + dims, 0.0);
            }
            let ix = *owner_ix.entry(row.owner).or_insert_with_key(|owner| {
                owners.push(owner.clone());
                (owners.len() - 1) as u32
            });
            owner_of.push(ix);
            keys.push(row.key);
        }

        Index {
            dims,
            vectors,
            keys,
            owner_of,
            owners,
            model,
        }
    }

    pub fn len(&self) -> usize {
        self.keys.len()
    }

    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    pub fn model(&self) -> Option<&str> {
        self.model.as_deref()
    }

    /// The best `limit` rows for `query`: the project's first, then by
    /// similarity, as every search has ranked since the project scope arrived.
    ///
    /// The filter applies before scoring, so `limit` results come back
    /// whenever that many rows pass it, however many better ones it excluded.
    pub fn search<'a>(
        &'a self,
        query: &[f32],
        filter: &Filter<'a>,
        limit: usize,
    ) -> Vec<Found<'a>> {
        if limit == 0 {
            return Vec::new();
        }

        // A query from another model, or of no width, matches nothing better
        // than anything else: every row scores 0.
        let mut q = query.to_vec();
        let comparable = q.len() == self.dims;
        if comparable {
            normalise(&mut q);
        }

        // Per file, once: its work, and whether that work is in the project.
        let owners: Vec<(&str, bool)> = self
            .owners
            .iter()
            .map(|owner| {
                let work = queries::resolve(filter.aliases, owner);
                (work, filter.project.contains(work))
            })
            .collect();

        let mut scored: Vec<(usize, f32, bool)> = Vec::new();
        for (i, key) in self.keys.iter().enumerate() {
            if !filter.kinds.is_empty() && !filter.kinds.contains(&key.kind()) {
                continue;
            }
            let (_, in_project) = owners[self.owner_of[i] as usize];
            if !in_project && !filter.include_library {
                continue;
            }
            let similarity = if comparable {
                let row = &self.vectors[i * self.dims..(i + 1) * self.dims];
                row.iter().zip(&q).map(|(a, b)| a * b).sum()
            } else {
                0.0
            };
            scored.push((i, similarity, in_project));
        }

        // Project first, then the closest; ties in the order rows were read, so
        // the same library always gives the same list.
        let order = |a: &(usize, f32, bool), b: &(usize, f32, bool)| {
            b.2.cmp(&a.2).then(b.1.total_cmp(&a.1)).then(a.0.cmp(&b.0))
        };
        if scored.len() > limit {
            scored.select_nth_unstable_by(limit - 1, order);
            scored.truncate(limit);
        }
        scored.sort_unstable_by(order);

        scored
            .into_iter()
            .map(|(i, similarity, in_project)| Found {
                key: &self.keys[i],
                source_id: owners[self.owner_of[i] as usize].0,
                similarity,
                in_project,
            })
            .collect()
    }
}

/// Read every vector in the library and build the index from them.
pub async fn load(library: &SqlitePool) -> Result<Index, String> {
    let meta = queries::embedding_meta(library).await?;
    load_under(library, meta).await
}

/// `load`, under `meta` (the model and width `embedding_meta` records) already
/// read, so `IndexState::get` doesn't read it twice.
///
/// The read is async I/O; normalising and packing tens of thousands of rows is
/// CPU work, so it runs on the blocking pool rather than an async worker.
async fn load_under(library: &SqlitePool, meta: Option<(String, i64)>) -> Result<Index, String> {
    let dims = meta
        .as_ref()
        .and_then(|(_, dims)| usize::try_from(*dims).ok());
    let model = meta.map(|(model, _)| model);
    let rows = queries::index_rows(library).await?;
    tokio::task::spawn_blocking(move || Index::build(rows, model, dims))
        .await
        .map_err(|e| e.to_string())
}

/// The open library's index, built on first use and dropped when it may be
/// out of date.
///
/// `generation` counts invalidations. A build that started before one isn't
/// kept: what it read may already be gone.
#[derive(Default)]
pub struct IndexState {
    slot: std::sync::Mutex<Slot>,
    /// One build at a time: queries that arrive during a build wait for it
    /// rather than each reading the whole library again.
    building: tokio::sync::Mutex<()>,
}

#[derive(Default)]
struct Slot {
    generation: u64,
    index: Option<Arc<Index>>,
}

impl IndexState {
    fn slot(&self) -> std::sync::MutexGuard<'_, Slot> {
        self.slot.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Whether an index is held. For tests: building is meant to be lazy.
    pub fn is_built(&self) -> bool {
        self.slot().index.is_some()
    }

    /// How many times the index has been dropped. Read before choosing which
    /// library to build from, and handed to `get`.
    pub fn generation(&self) -> u64 {
        self.slot().generation
    }

    /// Forget the index. The next query builds a new one.
    pub fn invalidate(&self) {
        let mut slot = self.slot();
        slot.generation += 1;
        slot.index = None;
    }

    /// The index for `library`, building it if there isn't a current one.
    ///
    /// A different model in `embedding_meta` than the index was built from
    /// means its vectors are from another space: it's rebuilt.
    ///
    /// `generation` is `self.generation()` as it was before the caller picked
    /// `library`. If anything was dropped since, `library` may be one that has
    /// been closed (`open_library` swaps the pool, then invalidates), and
    /// what's held now may be another library's. So:
    ///
    /// - before building, `None`: the caller picks the library again, rather
    ///   than every query queued behind a build reading the whole library only
    ///   to throw it away;
    /// - during the build, the index answers this query, from the pool it was
    ///   asked about, and isn't kept.
    pub async fn get(
        &self,
        library: &SqlitePool,
        generation: u64,
    ) -> Result<Option<Arc<Index>>, String> {
        let meta = queries::embedding_meta(library).await?;
        let model = meta.as_ref().map(|(model, _)| model.as_str());
        let current = |state: &Self| {
            let slot = state.slot();
            if slot.generation != generation {
                return Err(());
            }
            Ok(slot.index.clone().filter(|index| index.model() == model))
        };

        match current(self) {
            Err(()) => return Ok(None),
            Ok(Some(index)) => return Ok(Some(index)),
            Ok(None) => {}
        }
        let _one = self.building.lock().await;
        match current(self) {
            Err(()) => return Ok(None),
            Ok(Some(index)) => return Ok(Some(index)),
            Ok(None) => {}
        }

        let index = Arc::new(load_under(library, meta).await?);
        let mut slot = self.slot();
        if slot.generation == generation {
            slot.index = Some(index.clone());
        }
        Ok(Some(index))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(key: Key, owner: &str, embedding: &[f32]) -> Row {
        Row {
            key,
            owner: owner.to_string(),
            embedding: embedding.to_vec(),
        }
    }

    fn chunk(sha256: &str, idx: i64) -> Key {
        Key::Chunk {
            sha256: sha256.to_string(),
            idx,
        }
    }

    // M2-1 AC-1
    #[test]
    fn rows_are_held_normalised_and_tagged_with_their_kind() {
        let index = Index::build(
            vec![
                row(chunk("a", 0), "a", &[3.0, 4.0]),
                row(Key::Annotation("m1".into()), "a", &[0.0, 2.0]),
                row(Key::SourceNote("n1".into()), "a", &[0.0, 0.0]),
            ],
            Some("model".into()),
            None,
        );

        assert_eq!(index.len(), 3);
        assert_eq!(index.vectors, vec![0.6, 0.8, 0.0, 1.0, 0.0, 0.0]);
        let kinds: Vec<HitKind> = index.keys.iter().map(Key::kind).collect();
        assert_eq!(
            kinds,
            [HitKind::Chunk, HitKind::Annotation, HitKind::SourceNote]
        );
        assert_eq!(index.model(), Some("model"));
    }

    // M2-1 AC-1
    #[test]
    fn a_dot_product_on_the_index_is_cosine_similarity() {
        let a = [0.3, -1.2, 2.5];
        let b = [1.1, 0.4, -0.7];
        let index = Index::build(vec![row(chunk("a", 0), "a", &a)], None, None);
        let project = HashSet::from(["a"]);
        let filter = Filter {
            kinds: &[],
            project: &project,
            include_library: false,
            aliases: &HashMap::new(),
        };

        let found = index.search(&b, &filter, 1);

        let cosine = crate::commands::cosine_similarity(&a, &b);
        assert!((found[0].similarity - cosine).abs() < 1e-6);
    }

    // M2-1 AC-3
    #[test]
    fn filters_apply_before_scoring_so_the_limit_is_filled() {
        // The two library rows are the closest matches, and a top-2 scored
        // first and filtered after would come back empty.
        let index = Index::build(
            vec![
                row(chunk("lib", 0), "lib", &[1.0, 0.0]),
                row(chunk("lib", 1), "lib", &[1.0, 0.1]),
                row(chunk("mine", 0), "mine", &[0.5, 0.5]),
                row(Key::Annotation("m1".into()), "mine", &[1.0, 0.0]),
                row(chunk("mine", 1), "mine", &[0.0, 1.0]),
            ],
            None,
            None,
        );
        let project = HashSet::from(["mine"]);
        let filter = Filter {
            kinds: &[HitKind::Chunk],
            project: &project,
            include_library: false,
            aliases: &HashMap::new(),
        };

        let found = index.search(&[1.0, 0.0], &filter, 2);

        let keys: Vec<&Key> = found.iter().map(|f| f.key).collect();
        assert_eq!(keys, [&chunk("mine", 0), &chunk("mine", 1)]);
    }

    #[test]
    fn the_project_ranks_first_and_a_file_counts_as_its_work() {
        // `alias` is a file attached to the work `work`, which the project
        // names; its rows are the project's, resolved when searched.
        let index = Index::build(
            vec![
                row(chunk("other", 0), "other", &[1.0, 0.0]),
                row(chunk("alias", 0), "alias", &[0.0, 1.0]),
            ],
            None,
            None,
        );
        let project = HashSet::from(["work"]);
        let aliases = HashMap::from([("alias".to_string(), "work".to_string())]);
        let filter = Filter {
            kinds: &[],
            project: &project,
            include_library: true,
            aliases: &aliases,
        };

        let found = index.search(&[1.0, 0.0], &filter, 5);

        assert_eq!(found[0].key, &chunk("alias", 0));
        assert_eq!(found[0].source_id, "work");
        assert!(found[0].in_project);
        assert_eq!(found[1].key, &chunk("other", 0));
        assert!(!found[1].in_project);
    }

    #[test]
    fn the_width_is_the_current_models_not_whichever_row_came_first() {
        // An old model's vector read first, as rows come in no order: taking
        // its width zeroed every current row, and nothing ranked by meaning.
        let index = Index::build(
            vec![
                row(chunk("old", 0), "a", &[1.0, 0.0, 0.0]),
                row(chunk("a", 0), "a", &[0.0, 1.0]),
                row(chunk("a", 1), "a", &[1.0, 0.0]),
            ],
            Some("current".into()),
            Some(2),
        );
        let project = HashSet::from(["a"]);
        let filter = Filter {
            kinds: &[],
            project: &project,
            include_library: false,
            aliases: &HashMap::new(),
        };

        let found = index.search(&[1.0, 0.0], &filter, 3);

        assert_eq!(found[0].key, &chunk("a", 1));
        assert!((found[0].similarity - 1.0).abs() < 1e-6);
        let old = found.iter().find(|f| f.key == &chunk("old", 0)).unwrap();
        assert_eq!(old.similarity, 0.0);
    }

    #[test]
    fn with_no_model_recorded_the_width_is_the_one_most_rows_have() {
        // Nothing writes embedding_meta yet, so in the app this is the path
        // every library takes.
        let rows = |old_first: bool| {
            let mut rows = vec![
                row(chunk("a", 0), "a", &[0.0, 1.0]),
                row(chunk("a", 1), "a", &[1.0, 0.0]),
            ];
            let old = row(chunk("old", 0), "a", &[1.0, 0.0, 0.0]);
            if old_first {
                rows.insert(0, old);
            } else {
                rows.push(old);
            }
            rows
        };

        for old_first in [true, false] {
            let index = Index::build(rows(old_first), None, None);
            assert_eq!(index.dims, 2, "old row first: {old_first}");
        }
    }

    #[test]
    fn a_recorded_width_no_row_has_sizes_nothing() {
        // A bad meta row must not size a matrix of zeros: billions of floats
        // would abort the app. The rows' own width serves instead.
        let index = Index::build(
            vec![row(chunk("a", 0), "a", &[1.0, 0.0])],
            Some("current".into()),
            Some(4_000_000_000),
        );

        assert_eq!(index.dims, 2);
        assert_eq!(index.vectors.len(), 2);
    }

    #[test]
    fn a_vector_of_another_width_scores_zero_rather_than_failing() {
        let index = Index::build(
            vec![
                row(chunk("a", 0), "a", &[1.0, 0.0]),
                row(chunk("a", 1), "a", &[1.0, 0.0, 0.0]),
                row(chunk("a", 2), "a", &[0.0, 1.0]),
            ],
            None,
            None,
        );
        let project = HashSet::from(["a"]);
        let filter = Filter {
            kinds: &[],
            project: &project,
            include_library: false,
            aliases: &HashMap::new(),
        };

        let found = index.search(&[1.0, 0.0], &filter, 5);
        assert_eq!(found.len(), 3);
        let odd = found.iter().find(|f| f.key == &chunk("a", 1)).unwrap();
        assert_eq!(odd.similarity, 0.0);

        let other_model = index.search(&[1.0, 0.0, 0.0], &filter, 5);
        assert!(other_model.iter().all(|f| f.similarity == 0.0));
    }
}
