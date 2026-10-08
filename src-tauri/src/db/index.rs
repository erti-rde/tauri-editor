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
//! first query, and needs no migration of its own. After that, each command
//! that writes a vector reads back the rows it touched and swaps them in
//! (M2-2), so an ingest or a new note doesn't cost the next search a rebuild.
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
///
/// Ordered, so rows that score the same are listed by what they are rather than
/// by where they happen to sit in the index, which updates in place reorder.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
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

/// Rows a write may have changed: what's held for them is swapped for what the
/// library has now (M2-2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Changed {
    /// Every row the file or work owns: its passages, its marks, its notes.
    Owner(String),
    /// A file's passages.
    ChunksOf(String),
    /// The marks on a file.
    AnnotationsOf(String),
    /// The notes on a work.
    SourceNotesOf(String),
    Annotation(String),
    SourceNote(String),
}

impl Changed {
    fn covers(&self, key: &Key, owner: &str) -> bool {
        match (self, key) {
            (Changed::Owner(o), _) => o == owner,
            (Changed::ChunksOf(o), Key::Chunk { .. })
            | (Changed::AnnotationsOf(o), Key::Annotation(_))
            | (Changed::SourceNotesOf(o), Key::SourceNote(_)) => o == owner,
            (Changed::Annotation(id), Key::Annotation(k))
            | (Changed::SourceNote(id), Key::SourceNote(k)) => id == k,
            _ => false,
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

/// Cloned only when a write lands while a search still holds the index.
#[derive(Clone)]
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
    /// Where each owner is in `owners`, so a row added later joins its file.
    owner_ix: HashMap<String, u32>,
    /// Each row's width as stored, and how many rows have each: the width a
    /// build would choose now, so an update that would change it is noticed.
    widths: Vec<usize>,
    width_counts: HashMap<usize, usize>,
    /// The width `embedding_meta` records for the model, if any.
    recorded: Option<usize>,
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
/// when some row has it, else the width most rows have. `counts` is how many
/// rows have each width.
///
/// Not the first row's: after a change of model, a library can still hold
/// vectors from the last one, and rows come in no particular order. Taking an
/// old row's width zeroed every current one, so nothing ranked by meaning at
/// all. And nothing records a model yet, so the rows themselves have to say.
///
/// The recorded width counts only when a row has it, so a bad one can't size
/// a matrix that holds nothing: every row would be zeroed anyway.
fn width(counts: &HashMap<usize, usize>, recorded: Option<usize>) -> usize {
    if let Some(dims) = recorded.filter(|d| counts.contains_key(d)) {
        return dims;
    }
    // Ties to the wider, so the same library always gets the same width.
    counts
        .iter()
        .max_by_key(|&(&dims, &count)| (count, dims))
        .map_or(0, |(&dims, _)| dims)
}

impl Index {
    /// Normalise and pack rows into one matrix. CPU work, for `spawn_blocking`.
    ///
    /// A row of another width came from another model; it's kept, as a zero
    /// vector, so it's still found by a filter and scores 0, which is what
    /// comparing vectors of different lengths gave.
    pub fn build(rows: Vec<Row>, model: Option<String>, recorded: Option<usize>) -> Index {
        let mut counts: HashMap<usize, usize> = HashMap::new();
        for row in &rows {
            *counts.entry(row.embedding.len()).or_default() += 1;
        }
        let dims = width(&counts, recorded);
        let mut index = Index {
            dims,
            vectors: Vec::with_capacity(rows.len() * dims),
            keys: Vec::with_capacity(rows.len()),
            owner_of: Vec::with_capacity(rows.len()),
            owners: Vec::new(),
            owner_ix: HashMap::new(),
            widths: Vec::with_capacity(rows.len()),
            width_counts: HashMap::new(),
            recorded,
            model,
        };
        for row in rows {
            index.push(row);
        }
        index
    }

    /// Add a row at the end, at the index's width.
    fn push(&mut self, row: Row) {
        let start = self.vectors.len();
        if row.embedding.len() == self.dims {
            self.vectors.extend_from_slice(&row.embedding);
            normalise(&mut self.vectors[start..]);
        } else {
            self.vectors.resize(start + self.dims, 0.0);
        }
        let owners = &mut self.owners;
        let ix = *self.owner_ix.entry(row.owner).or_insert_with_key(|owner| {
            owners.push(owner.clone());
            (owners.len() - 1) as u32
        });
        self.owner_of.push(ix);
        *self.width_counts.entry(row.embedding.len()).or_default() += 1;
        self.widths.push(row.embedding.len());
        self.keys.push(row.key);
    }

    /// Take out row `i`, moving the last row into its place: rows are in no
    /// order that matters, and this moves one row rather than all after it.
    fn swap_remove(&mut self, i: usize) {
        let last = self.keys.len() - 1;
        let d = self.dims;
        if i != last {
            self.vectors.copy_within(last * d..(last + 1) * d, i * d);
        }
        self.vectors.truncate(last * d);
        self.keys.swap_remove(i);
        self.owner_of.swap_remove(i);
        let w = self.widths.swap_remove(i);
        if let Some(count) = self.width_counts.get_mut(&w) {
            *count -= 1;
            if *count == 0 {
                self.width_counts.remove(&w);
            }
        }
    }

    /// The rows held now that `changed` covers. Read again with what changed,
    /// so a row that moved to another owner (a note, when its work becomes
    /// another's file) is found where it went.
    pub fn covered(&self, changed: &[Changed]) -> Vec<Key> {
        self.keys
            .iter()
            .zip(&self.owner_of)
            .filter(|(key, &o)| {
                let owner = &self.owners[o as usize];
                changed.iter().any(|c| c.covers(key, owner))
            })
            .map(|(key, _)| key.clone())
            .collect()
    }

    /// Swap the rows `changed` covers, and any row held under a key in `rows`,
    /// for `rows`: what the library has for them now (M2-2).
    ///
    /// False when the index is no longer the one a build would give, because
    /// a build now would choose another width (a first paper in an empty
    /// library, or the last of a model's rows gone): the caller drops it.
    pub fn replace(&mut self, changed: &[Changed], rows: Vec<Row>) -> bool {
        let gone: Vec<usize> = {
            let fresh: HashSet<&Key> = rows.iter().map(|r| &r.key).collect();
            (0..self.keys.len())
                .filter(|&i| {
                    let owner = &self.owners[self.owner_of[i] as usize];
                    fresh.contains(&self.keys[i])
                        || changed.iter().any(|c| c.covers(&self.keys[i], owner))
                })
                .collect()
        };
        // From the end, so the row moved into a gap is never one still to go.
        for &i in gone.iter().rev() {
            self.swap_remove(i);
        }
        for row in rows {
            self.push(row);
        }
        width(&self.width_counts, self.recorded) == self.dims
    }

    /// Every row as held, in key order: its key, its owner and its vector.
    /// For tests: an index updated in place should hold what a build would.
    pub fn entries(&self) -> Vec<(Key, &str, &[f32])> {
        let d = self.dims;
        let mut rows: Vec<_> = self
            .keys
            .iter()
            .enumerate()
            .map(|(i, key)| {
                let owner = self.owners[self.owner_of[i] as usize].as_str();
                (key.clone(), owner, &self.vectors[i * d..(i + 1) * d])
            })
            .collect();
        rows.sort_by(|a, b| a.0.cmp(&b.0));
        rows
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

        // Project first, then the closest; ties by the row's key, so the same
        // library always gives the same list, however its rows came to be
        // where they are in the index.
        let order = |a: &(usize, f32, bool), b: &(usize, f32, bool)| {
            b.2.cmp(&a.2)
                .then(b.1.total_cmp(&a.1))
                .then_with(|| self.keys[a.0].cmp(&self.keys[b.0]))
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

/// The open library's index, built on first use, kept current by the writers,
/// and dropped when it can't be.
///
/// `generation` counts drops. A build that started before one isn't kept:
/// what it read may already be gone.
#[derive(Default)]
pub struct IndexState {
    slot: std::sync::Mutex<Slot>,
    /// One build at a time: queries that arrive during a build wait for it
    /// rather than each reading the whole library again.
    building: tokio::sync::Mutex<()>,
    /// One update at a time, each reading the library after its write. The
    /// last update to read then follows the last write, whatever order two
    /// writers finish in, so a slower one can't put back what a faster one
    /// replaced.
    updating: tokio::sync::Mutex<()>,
}

#[derive(Default)]
struct Slot {
    generation: u64,
    index: Option<Arc<Index>>,
}

impl Slot {
    fn drop_index(&mut self) {
        self.generation += 1;
        self.index = None;
    }
}

impl IndexState {
    fn slot(&self) -> std::sync::MutexGuard<'_, Slot> {
        self.slot.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Whether an index is held. For tests: building is meant to be lazy.
    pub fn is_built(&self) -> bool {
        self.slot().index.is_some()
    }

    /// The index held now, if any. For tests: to see that a write updated it
    /// rather than dropping it.
    pub fn held(&self) -> Option<Arc<Index>> {
        self.slot().index.clone()
    }

    /// How many times the index has been dropped. Read before choosing which
    /// library to build from, and handed to `get`.
    pub fn generation(&self) -> u64 {
        self.slot().generation
    }

    /// Forget the index. The next query builds a new one.
    pub fn invalidate(&self) {
        self.slot().drop_index();
    }

    /// Bring the index up to date with a write to `library`: what `changed`
    /// covers is read again and swapped in (M2-2).
    ///
    /// `generation` is `self.generation()` as it was before the caller picked
    /// `library`, after the write. If the index has been dropped since,
    /// whatever is built next reads the library afresh, and nothing is done.
    /// With no index held, a build may be under way that read the library
    /// before the write, so it's dropped, as before M2-2. If the rows can't be
    /// read, the index is dropped too: it's never left holding a guess.
    pub async fn refresh(&self, library: &SqlitePool, generation: u64, changed: &[Changed]) {
        let _one = self.updating.lock().await;
        let held = {
            let mut slot = self.slot();
            if slot.generation != generation {
                return;
            }
            match &slot.index {
                Some(index) => index.covered(changed),
                None => return slot.drop_index(),
            }
        };

        let rows = queries::index_rows_for(library, changed, &held).await;
        let mut slot = self.slot();
        if slot.generation != generation {
            return;
        }
        let (Ok(rows), Some(index)) = (rows, slot.index.as_mut()) else {
            return slot.drop_index();
        };
        // In place unless a search is still holding this index, which keeps
        // the one it was handed.
        if !Arc::make_mut(index).replace(changed, rows) {
            slot.drop_index();
        }
    }

    /// The index for `library`, building it if there isn't a current one.
    ///
    /// A different model in `embedding_meta` than the index was built from
    /// means its vectors are from another space: it's dropped and rebuilt.
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
            let mut slot = state.slot();
            if slot.generation != generation {
                return Err(());
            }
            match &slot.index {
                Some(index) if index.model() != model => {
                    // Dropped, not replaced at this generation: an update
                    // racing the rebuild would otherwise land on the old
                    // index and be lost when the new one, read before the
                    // write, took its place.
                    slot.drop_index();
                    Err(())
                }
                index => Ok(index.clone()),
            }
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

    // M2-2 AC-2
    #[test]
    fn rows_swapped_in_place_hold_what_a_build_of_the_result_would() {
        let start = || {
            vec![
                row(chunk("a", 0), "a", &[1.0, 0.0]),
                row(chunk("a", 1), "a", &[0.0, 1.0]),
                row(Key::Annotation("m1".into()), "a", &[1.0, 1.0]),
                row(chunk("b", 0), "b", &[3.0, 4.0]),
                row(Key::SourceNote("n1".into()), "b", &[0.0, 2.0]),
            ]
        };
        let mut index = Index::build(start(), None, None);

        // `a` read again with one passage, `m1` gone, and `n1` moved to `a`.
        let changed = [
            Changed::ChunksOf("a".into()),
            Changed::Annotation("m1".into()),
        ];
        let fresh = vec![
            row(chunk("a", 0), "a", &[0.5, 0.5]),
            row(Key::SourceNote("n1".into()), "a", &[0.0, 2.0]),
        ];
        assert!(index.replace(&changed, fresh));

        let built = Index::build(
            vec![
                row(chunk("b", 0), "b", &[3.0, 4.0]),
                row(chunk("a", 0), "a", &[0.5, 0.5]),
                row(Key::SourceNote("n1".into()), "a", &[0.0, 2.0]),
            ],
            None,
            None,
        );
        assert_eq!(index.entries(), built.entries());
    }

    // M2-2
    #[test]
    fn an_update_that_would_change_the_width_asks_for_a_build() {
        // Two rows of an old model's width, one of the current; a build takes
        // the width most rows have. Losing the old rows changes that.
        let mut index = Index::build(
            vec![
                row(chunk("old", 0), "old", &[1.0, 0.0, 0.0]),
                row(chunk("old", 1), "old", &[0.0, 1.0, 0.0]),
                row(chunk("new", 0), "new", &[1.0, 0.0]),
            ],
            None,
            None,
        );
        assert_eq!(index.dims, 3);

        assert!(!index.replace(&[Changed::Owner("old".into())], Vec::new()));
    }
}
