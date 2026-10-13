//! Version history (ADR 007, M5-1).
//!
//! Autosave overwrites the manuscript in place, so a section deleted on Monday
//! was gone by Tuesday. A snapshot is a copy of the manuscript file as it was
//! saved, at `<project>/.erti/history/<document stem>/<UTC>.erti.json`: an
//! ordinary manuscript, which can be opened, compared or copied back by hand
//! without Erti, and which survives a damaged project database.
//!
//! - **Taken** by the webview's request: at most every ten minutes while a
//!   document is being written, on close and quit, and before a restore. The
//!   ten-minute rule and "nothing changed since the last one" are decided here,
//!   so a request too soon, or for the same bytes, is simply not a snapshot.
//! - **Thinned** on project open, never on the typing path: everything from
//!   the last day, then the newest of each hour for a week, of each day for
//!   three months, and of each week after that.
//! - **Restored** by copying the snapshot over the manuscript, after taking one
//!   of the manuscript as it is, so a restore can itself be undone.
//!
//! What triggered each snapshot and how many words it held sit beside them in
//! `snapshots.json`. That's for the list; losing it loses only the labels, and
//! a snapshot without an entry (one copied in by hand) is listed all the same.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::db::backup::{civil_from_days, days_from_civil};
use crate::db::DbState;
use crate::ipc::{AppError, ErrorKind};

/// A snapshot's extension: it is a manuscript like any other.
pub const EXTENSION: &str = ".erti.json";
/// Beside the snapshots: what triggered each, and its words.
pub const INDEX: &str = "snapshots.json";
/// While writing, a snapshot at most this often (seconds).
pub const WHILE_WRITING_EVERY: i64 = 10 * 60;

const HOUR: i64 = 60 * 60;
const DAY: i64 = 24 * HOUR;

/// Why a snapshot was taken, as the history list says it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum Trigger {
    /// Every ten minutes at most, while the document changes.
    Writing,
    /// The document was closed: another opened, or the editor left.
    Close,
    /// The app quit.
    Quit,
    /// The manuscript as it was, just before a snapshot replaced it.
    BeforeRestore,
}

impl Trigger {
    fn parse(text: &str) -> Option<Self> {
        serde_json::from_value(serde_json::Value::String(text.to_owned())).ok()
    }

    fn name(self) -> String {
        match serde_json::to_value(self) {
            Ok(serde_json::Value::String(name)) => name,
            _ => unreachable!("a unit variant serialises as its name"),
        }
    }
}

/// One snapshot, as the history list shows it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Its file name in the document's history folder.
    pub file: String,
    /// When it was taken, in seconds since 1970 (UTC), read from its name.
    #[specta(type = specta_typescript::Number)]
    pub taken_at: i64,
    /// What took it. None for a snapshot `snapshots.json` doesn't know.
    pub trigger: Option<Trigger>,
    /// Its words, as the editor counted them. None when unknown.
    pub words: Option<u32>,
    #[specta(type = specta_typescript::Number)]
    pub bytes: u64,
}

/// A document's snapshots, newest first, and the space they take.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct History {
    pub snapshots: Vec<Snapshot>,
    #[specta(type = specta_typescript::Number)]
    pub bytes: u64,
}

/// `2026-10-13T10-24-16Z.erti.json`: the UTC time, sortable, and without the
/// colons Windows refuses in a file name.
pub fn name_for(secs: i64) -> String {
    let (y, m, d) = civil_from_days(secs.div_euclid(DAY));
    let s = secs.rem_euclid(DAY);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}-{:02}-{:02}Z{EXTENSION}",
        s / HOUR,
        s % HOUR / 60,
        s % 60
    )
}

/// When a snapshot was taken, read from its name. None for any other file,
/// including a name that only looks like one (the 30th of February).
pub fn time_of_name(name: &str) -> Option<i64> {
    let stamp = name.strip_suffix(EXTENSION)?;
    let bytes = stamp.as_bytes();
    if bytes.len() != 20 {
        return None;
    }
    let separators = [
        (4, b'-'),
        (7, b'-'),
        (10, b'T'),
        (13, b'-'),
        (16, b'-'),
        (19, b'Z'),
    ];
    if separators.iter().any(|&(at, c)| bytes[at] != c) {
        return None;
    }
    let number = |from: usize, to: usize| -> Option<i64> {
        let digits = stamp.get(from..to)?;
        digits
            .bytes()
            .all(|b| b.is_ascii_digit())
            .then(|| digits.parse().ok())?
    };
    let (y, m, d) = (number(0, 4)?, number(5, 7)?, number(8, 10)?);
    let (hh, mm, ss) = (number(11, 13)?, number(14, 16)?, number(17, 19)?);
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) || hh > 23 || mm > 59 || ss > 59 {
        return None;
    }
    let secs = days_from_civil(y, m, d) * DAY + hh * HOUR + mm * 60 + ss;
    // A date that doesn't exist comes back as another one.
    (name_for(secs) == name).then_some(secs)
}

/// Which snapshots to delete, given when each was taken (ADR 007).
///
/// Everything from the last day stays. Older ones are bucketed by the hour (up
/// to a week old), the day (up to three months) or the week (after that), and
/// each bucket keeps its newest: the work as it stood at the end of that hour,
/// day or week. Weeks start on Monday. A snapshot from the future (a clock set
/// wrong) is younger than a day, and stays.
pub fn to_delete(times: &[i64], now: i64) -> Vec<i64> {
    let mut newest_first = times.to_vec();
    newest_first.sort_unstable_by(|a, b| b.cmp(a));
    newest_first.dedup();

    let mut kept = HashSet::new();
    let mut delete = Vec::new();
    for t in newest_first {
        let age = now - t;
        let bucket = if age < DAY {
            continue;
        } else if age < 7 * DAY {
            (0, t.div_euclid(HOUR))
        } else if age < 90 * DAY {
            (1, t.div_euclid(DAY))
        } else {
            // 1970-01-01 was a Thursday, so day + 3 counts weeks from a Monday.
            (2, (t.div_euclid(DAY) + 3).div_euclid(7))
        };
        if !kept.insert(bucket) {
            delete.push(t);
        }
    }
    delete
}

/// One writer at a time over the history folders: the editor's ten-minute
/// snapshot and a close can arrive together, and both rewrite the index.
static LOCK: Mutex<()> = Mutex::new(());

fn lock() -> std::sync::MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct Entry {
    /// A string, not a `Trigger`: an index written by a later Erti may name
    /// one this build doesn't know, and that mustn't lose the rest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    trigger: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    words: Option<u32>,
}

#[derive(Default, Serialize, Deserialize)]
struct Index {
    #[serde(default)]
    snapshots: BTreeMap<String, Entry>,
}

/// The index, or an empty one if it's missing or damaged: it only labels.
fn read_index(dir: &Path) -> Index {
    std::fs::read(dir.join(INDEX))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// The index, kept to the snapshots that are there.
fn write_index(dir: &Path, mut index: Index, present: &[(i64, String)]) -> io::Result<()> {
    index
        .snapshots
        .retain(|name, _| present.iter().any(|(_, n)| n == name));
    let json = serde_json::to_vec_pretty(&index).map_err(io::Error::other)?;
    write_atomic(&dir.join(INDEX), &json)
}

/// Written under a hidden name and moved into place, so a crash halfway
/// leaves the old file whole rather than a half-written one in its place.
fn write_atomic(target: &Path, bytes: &[u8]) -> io::Result<()> {
    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no file name"))?;
    let partial = target.with_file_name(format!(".{name}.partial"));
    std::fs::write(&partial, bytes)?;
    std::fs::rename(&partial, target).inspect_err(|_| {
        let _ = std::fs::remove_file(&partial);
    })
}

/// The snapshots in `dir`, newest first, as (time, name).
fn snapshots_in(dir: &Path) -> Vec<(i64, String)> {
    let mut found: Vec<(i64, String)> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
                .filter_map(|e| e.file_name().into_string().ok())
                .filter_map(|name| Some((time_of_name(&name)?, name)))
                .collect()
        })
        .unwrap_or_default();
    found.sort_unstable_by(|a, b| b.cmp(a));
    found
}

fn snapshot(dir: &Path, time: i64, name: &str, entry: Option<&Entry>) -> Snapshot {
    Snapshot {
        file: name.to_owned(),
        taken_at: time,
        trigger: entry
            .and_then(|e| e.trigger.as_deref())
            .and_then(Trigger::parse),
        words: entry.and_then(|e| e.words),
        bytes: std::fs::metadata(dir.join(name))
            .map(|m| m.len())
            .unwrap_or(0),
    }
}

/// A document's snapshots, newest first.
pub fn list(dir: &Path) -> History {
    let _guard = lock();
    let index = read_index(dir);
    let snapshots: Vec<Snapshot> = snapshots_in(dir)
        .iter()
        .map(|(time, name)| snapshot(dir, *time, name, index.snapshots.get(name)))
        .collect();
    let bytes = snapshots.iter().map(|s| s.bytes).sum::<u64>()
        + std::fs::metadata(dir.join(INDEX))
            .map(|m| m.len())
            .unwrap_or(0);
    History { snapshots, bytes }
}

fn take_locked(
    dir: &Path,
    document: &Path,
    trigger: Trigger,
    words: Option<u32>,
    now: i64,
) -> io::Result<Option<Snapshot>> {
    // Before reading anything: while writing, this is asked after every save,
    // and nearly every time the answer is "too soon".
    let existing = snapshots_in(dir);
    let newest = existing.first();
    if let Some((time, _)) = newest {
        if trigger == Trigger::Writing && now - time < WHILE_WRITING_EVERY {
            return Ok(None);
        }
    }

    let content = match std::fs::read(document) {
        Ok(content) => content,
        // Nothing saved yet: nothing to keep.
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    // The newest already holds these bytes: a second copy is only noise.
    if let Some((_, name)) = newest {
        if std::fs::read(dir.join(name)).is_ok_and(|kept| kept == content) {
            return Ok(None);
        }
    }

    std::fs::create_dir_all(dir)?;
    // Two in one second (a close, then a restore) get the next free second.
    let mut at = now;
    while dir.join(name_for(at)).exists() {
        at += 1;
    }
    let name = name_for(at);
    write_atomic(&dir.join(&name), &content)?;

    let entry = Entry {
        trigger: Some(trigger.name()),
        words,
    };
    let mut index = read_index(dir);
    index.snapshots.insert(name.clone(), entry.clone());
    let mut present = existing;
    present.push((at, name.clone()));
    // The snapshot is safe whether or not its label is: a failure here costs
    // the list its trigger and words for this one, nothing more.
    if let Err(e) = write_index(dir, index, &present) {
        log::warn!("could not update the history index: {e}");
    }
    Ok(Some(snapshot(dir, at, &name, Some(&entry))))
}

/// A snapshot of `document` into `dir`, unless it's too soon after the last
/// (while writing) or the last already holds the same bytes. None then, and
/// when the document has never been saved.
pub fn take(
    dir: &Path,
    document: &Path,
    trigger: Trigger,
    words: Option<u32>,
    now: i64,
) -> io::Result<Option<Snapshot>> {
    let _guard = lock();
    take_locked(dir, document, trigger, words, now)
}

/// Put a snapshot back as the manuscript, keeping the manuscript as it was
/// first. Returns that snapshot, or None when the newest one already held it.
///
/// If the snapshot of the current state can't be written, nothing is
/// restored: a restore must never be the thing that loses work. That holds
/// for a manuscript Erti couldn't read too, whose bytes are kept as they are.
pub fn restore(
    dir: &Path,
    document: &Path,
    file: &str,
    words: Option<u32>,
    now: i64,
) -> io::Result<Option<Snapshot>> {
    if time_of_name(file).is_none() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "not a snapshot",
        ));
    }
    let _guard = lock();
    let content = std::fs::read(dir.join(file))?;
    let before = take_locked(dir, document, Trigger::BeforeRestore, words, now)?;
    write_atomic(document, &content)?;
    Ok(before)
}

/// Delete the snapshots taken before `cutoff`. Returns how many went.
pub fn clear_before(dir: &Path, cutoff: i64) -> io::Result<u32> {
    let _guard = lock();
    let existing = snapshots_in(dir);
    let mut cleared = 0;
    for (_, name) in existing.iter().filter(|(t, _)| *t < cutoff) {
        std::fs::remove_file(dir.join(name))?;
        cleared += 1;
    }
    if cleared > 0 {
        write_index(dir, read_index(dir), &snapshots_in(dir))?;
    }
    Ok(cleared)
}

/// Thin one document's snapshots (`to_delete`). Returns how many went.
pub fn thin(dir: &Path, now: i64) -> io::Result<u32> {
    let _guard = lock();
    let existing = snapshots_in(dir);
    let times: Vec<i64> = existing.iter().map(|(t, _)| *t).collect();
    let doomed = to_delete(&times, now);
    let mut thinned = 0;
    for (_, name) in existing.iter().filter(|(t, _)| doomed.contains(t)) {
        std::fs::remove_file(dir.join(name))?;
        thinned += 1;
    }
    if thinned > 0 {
        write_index(dir, read_index(dir), &snapshots_in(dir))?;
    }
    Ok(thinned)
}

/// Where a project's history lives.
pub fn root_of(project: &Path) -> PathBuf {
    project.join(".erti").join("history")
}

/// Thin every document's history in a project. A folder that fails is
/// logged and left for the next open; the others are still thinned.
pub fn thin_project(project: &Path, now: i64) -> u32 {
    let Ok(entries) = std::fs::read_dir(root_of(project)) else {
        return 0;
    };
    let mut thinned = 0;
    for dir in entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
    {
        match thin(&dir.path(), now) {
            Ok(n) => thinned += n,
            Err(e) => log::warn!("could not thin the history of {:?}: {e}", dir.file_name()),
        }
    }
    thinned
}

/// Now, in seconds since 1970.
pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// The name a manuscript's history folder takes: its file name without
/// Erti's extension. The document from before 1.0 is `magnum_opus`.
pub fn stem_of(file_name: &str) -> Option<&str> {
    let stem = file_name
        .strip_suffix(".erti.json")
        .or_else(|| (file_name == "magnum_opus.json").then_some("magnum_opus"))?;
    (!stem.is_empty() && !stem.starts_with('.')).then_some(stem)
}

fn not_a_manuscript() -> AppError {
    AppError::new(
        ErrorKind::InvalidInput,
        "That isn't a manuscript in this project.",
    )
}

/// A manuscript directly inside the open project, and its history folder.
///
/// The manuscript needn't exist: its history outlives it (M5-7). Its folder
/// must be the project's, after resolving `..` and symlinks, and a manuscript
/// that is itself a link to somewhere else is refused like any path outside.
pub async fn locate(state: &DbState, document: &str) -> Result<(PathBuf, PathBuf), AppError> {
    if crate::scope::refused_form(document) {
        return Err(AppError::new(
            ErrorKind::PermissionDenied,
            crate::scope::OUTSIDE,
        ));
    }
    let root = state.project_root().await?;
    let root = tokio::fs::canonicalize(&root)
        .await
        .map_err(|e| AppError::from_io(&e, &root))?;

    let path = Path::new(document);
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(not_a_manuscript)?;
    let stem = stem_of(name).ok_or_else(not_a_manuscript)?;
    let parent = path.parent().ok_or_else(not_a_manuscript)?;
    let outside = || AppError::new(ErrorKind::PermissionDenied, crate::scope::OUTSIDE);
    let parent = tokio::fs::canonicalize(parent)
        .await
        .map_err(|_| outside())?;
    if parent != root {
        return Err(outside());
    }

    let manuscript = root.join(name);
    if let Ok(resolved) = tokio::fs::canonicalize(&manuscript).await {
        if resolved.parent() != Some(root.as_path()) {
            return Err(outside());
        }
    }
    Ok((manuscript, root_of(&root).join(stem)))
}

fn snapshot_error(error: io::Error, path: &Path) -> AppError {
    if error.kind() == io::ErrorKind::InvalidInput {
        AppError::new(
            ErrorKind::InvalidInput,
            "That isn't one of this document's snapshots.",
        )
    } else {
        AppError::from_io(&error, path)
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, AppError> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| AppError::internal(format!("the history task failed: {e}")))
}

/// A document's snapshots, newest first, and the space they take.
#[tauri::command]
#[specta::specta]
pub async fn snapshot_history(
    state: tauri::State<'_, DbState>,
    document: String,
) -> Result<History, AppError> {
    snapshot_history_in(&state, document).await
}

pub async fn snapshot_history_in(state: &DbState, document: String) -> Result<History, AppError> {
    let (_, dir) = locate(state, &document).await?;
    blocking(move || list(&dir)).await
}

/// Take a snapshot of a manuscript as it's saved. None when it was too soon,
/// unchanged, or never saved.
#[tauri::command]
#[specta::specta]
pub async fn take_snapshot(
    state: tauri::State<'_, DbState>,
    document: String,
    trigger: Trigger,
    words: Option<u32>,
) -> Result<Option<Snapshot>, AppError> {
    take_snapshot_in(&state, document, trigger, words, now()).await
}

pub async fn take_snapshot_in(
    state: &DbState,
    document: String,
    trigger: Trigger,
    words: Option<u32>,
    now: i64,
) -> Result<Option<Snapshot>, AppError> {
    let (manuscript, dir) = locate(state, &document).await?;
    blocking(move || {
        take(&dir, &manuscript, trigger, words, now).map_err(|e| AppError::from_io(&e, &dir))
    })
    .await?
}

/// A snapshot's text, for the read-only preview.
#[tauri::command]
#[specta::specta]
pub async fn read_snapshot(
    state: tauri::State<'_, DbState>,
    document: String,
    file: String,
) -> Result<String, AppError> {
    read_snapshot_in(&state, document, file).await
}

pub async fn read_snapshot_in(
    state: &DbState,
    document: String,
    file: String,
) -> Result<String, AppError> {
    let (_, dir) = locate(state, &document).await?;
    if time_of_name(&file).is_none() {
        return Err(snapshot_error(io::ErrorKind::InvalidInput.into(), &dir));
    }
    let path = dir.join(&file);
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| AppError::from_io(&e, &path))
}

/// Put a snapshot back as the manuscript, after keeping the manuscript as it
/// is (`words`, its count, labels that snapshot). Returns the snapshot of the
/// state it replaced, or None when the newest already held it.
#[tauri::command]
#[specta::specta]
pub async fn restore_snapshot(
    state: tauri::State<'_, DbState>,
    document: String,
    file: String,
    words: Option<u32>,
) -> Result<Option<Snapshot>, AppError> {
    restore_snapshot_in(&state, document, file, words, now()).await
}

pub async fn restore_snapshot_in(
    state: &DbState,
    document: String,
    file: String,
    words: Option<u32>,
    now: i64,
) -> Result<Option<Snapshot>, AppError> {
    let (manuscript, dir) = locate(state, &document).await?;
    blocking(move || {
        restore(&dir, &manuscript, &file, words, now).map_err(|e| snapshot_error(e, &dir))
    })
    .await?
}

/// Delete a document's snapshots older than `older_than_days`. Returns how
/// many went.
#[tauri::command]
#[specta::specta]
pub async fn clear_snapshots(
    state: tauri::State<'_, DbState>,
    document: String,
    older_than_days: u32,
) -> Result<u32, AppError> {
    clear_snapshots_in(&state, document, older_than_days, now()).await
}

pub async fn clear_snapshots_in(
    state: &DbState,
    document: String,
    older_than_days: u32,
    now: i64,
) -> Result<u32, AppError> {
    let (_, dir) = locate(state, &document).await?;
    let cutoff = now - i64::from(older_than_days) * DAY;
    blocking(move || clear_before(&dir, cutoff).map_err(|e| AppError::from_io(&e, &dir))).await?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Seconds for a UTC time written out, for tables a person can read.
    fn at(stamp: &str) -> i64 {
        time_of_name(&format!("{stamp}{EXTENSION}")).expect(stamp)
    }

    // M5-1 AC-1
    #[test]
    fn names_are_the_utc_time_and_round_trip() {
        assert_eq!(name_for(0), "1970-01-01T00-00-00Z.erti.json");
        assert_eq!(name_for(1_791_887_056), "2026-10-13T10-24-16Z.erti.json");
        for secs in [0, 59, 86_399, 951_782_400, 1_791_887_056, 4_102_444_799] {
            assert_eq!(time_of_name(&name_for(secs)), Some(secs));
        }
    }

    // M5-1 AC-1
    #[test]
    fn only_snapshot_names_are_read_as_snapshots() {
        for name in [
            "snapshots.json",
            "Chapter 1.erti.json",
            "2026-10-13T10-24-16Z.json",
            "2026-10-13T10:24:16Z.erti.json",
            "2026-02-30T10-24-16Z.erti.json",
            "2026-13-01T10-24-16Z.erti.json",
            "2026-10-13T24-00-00Z.erti.json",
            "+026-10-13T10-24-16Z.erti.json",
            ".2026-10-13T10-24-16Z.erti.json.partial",
        ] {
            assert_eq!(time_of_name(name), None, "{name}");
        }
    }

    /// The thinning table (M5-1 AC-3): times relative to now, and which survive.
    fn kept(now: &str, times: &[&str]) -> Vec<String> {
        let now = at(now);
        let all: Vec<i64> = times.iter().map(|t| at(t)).collect();
        let gone = to_delete(&all, now);
        times
            .iter()
            .filter(|t| !gone.contains(&at(t)))
            .map(|t| t.to_string())
            .collect()
    }

    // M5-1 AC-3
    #[test]
    fn the_last_day_keeps_everything() {
        let times = [
            "2026-10-13T09-50-00Z",
            "2026-10-13T09-40-00Z",
            "2026-10-13T09-30-00Z",
            "2026-10-12T10-00-01Z",
        ];
        assert_eq!(kept("2026-10-13T10-00-00Z", &times), times);
    }

    // M5-1 AC-3
    #[test]
    fn a_week_keeps_the_newest_of_each_hour() {
        assert_eq!(
            kept(
                "2026-10-13T10-00-00Z",
                &[
                    "2026-10-12T09-50-00Z",
                    "2026-10-12T09-40-00Z",
                    "2026-10-12T09-00-00Z",
                    "2026-10-12T08-59-59Z",
                    "2026-10-07T10-30-00Z",
                    "2026-10-07T10-10-00Z",
                ]
            ),
            [
                "2026-10-12T09-50-00Z",
                "2026-10-12T08-59-59Z",
                "2026-10-07T10-30-00Z",
            ]
        );
    }

    // M5-1 AC-3
    #[test]
    fn three_months_keep_the_newest_of_each_day() {
        assert_eq!(
            kept(
                "2026-10-13T10-00-00Z",
                &[
                    "2026-10-06T09-00-00Z",
                    "2026-10-06T08-00-00Z",
                    "2026-10-05T23-00-00Z",
                    "2026-08-01T18-00-00Z",
                    "2026-08-01T09-00-00Z",
                    "2026-07-16T12-00-00Z",
                ]
            ),
            [
                "2026-10-06T09-00-00Z",
                "2026-10-05T23-00-00Z",
                "2026-08-01T18-00-00Z",
                "2026-07-16T12-00-00Z",
            ]
        );
    }

    // M5-1 AC-3
    #[test]
    fn after_three_months_the_newest_of_each_week() {
        // 2026-07-06 is a Monday; the 12th the Sunday that ends its week.
        assert_eq!(
            kept(
                "2026-10-13T10-00-00Z",
                &[
                    "2026-07-12T20-00-00Z",
                    "2026-07-09T10-00-00Z",
                    "2026-07-06T00-00-00Z",
                    "2026-07-05T23-59-59Z",
                    "2025-01-01T00-00-00Z",
                    "2024-12-31T00-00-00Z",
                ]
            ),
            [
                "2026-07-12T20-00-00Z",
                "2026-07-05T23-59-59Z",
                "2025-01-01T00-00-00Z",
            ]
        );
    }

    // M5-1 AC-3
    #[test]
    fn thinning_twice_changes_nothing_and_the_future_stays() {
        let now = at("2026-10-13T10-00-00Z");
        let times: Vec<i64> = (0..2000).map(|i| now + 3600 - i * 1777).collect();
        let gone = to_delete(&times, now);
        let left: Vec<i64> = times
            .iter()
            .copied()
            .filter(|t| !gone.contains(t))
            .collect();
        assert!(to_delete(&left, now).is_empty());
        assert!(left.contains(&(now + 3600)));
        assert!(left.len() < times.len());
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("erti-history-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // M5-1 AC-2
    #[test]
    fn while_writing_at_most_every_ten_minutes_and_never_the_same_twice() {
        let root = scratch("take");
        let doc = root.join("Chapter 1.erti.json");
        let dir = root.join("history");
        let t = at("2026-10-13T10-00-00Z");

        // Never saved: nothing to keep.
        assert_eq!(take(&dir, &doc, Trigger::Writing, None, t).unwrap(), None);

        std::fs::write(&doc, "one").unwrap();
        let first = take(&dir, &doc, Trigger::Writing, Some(1), t)
            .unwrap()
            .unwrap();
        assert_eq!(first.file, "2026-10-13T10-00-00Z.erti.json");
        assert_eq!(
            (first.trigger, first.words, first.bytes),
            (Some(Trigger::Writing), Some(1), 3)
        );

        std::fs::write(&doc, "one two").unwrap();
        assert_eq!(
            take(&dir, &doc, Trigger::Writing, Some(2), t + 599).unwrap(),
            None
        );
        assert!(take(&dir, &doc, Trigger::Writing, Some(2), t + 600)
            .unwrap()
            .is_some());

        // A close takes one whenever something changed, and never a duplicate.
        assert_eq!(
            take(&dir, &doc, Trigger::Close, Some(2), t + 601).unwrap(),
            None
        );
        std::fs::write(&doc, "one two three").unwrap();
        let closed = take(&dir, &doc, Trigger::Close, Some(3), t + 601)
            .unwrap()
            .unwrap();
        assert_eq!(closed.trigger, Some(Trigger::Close));

        let history = list(&dir);
        assert_eq!(
            history
                .snapshots
                .iter()
                .map(|s| (s.words, s.trigger))
                .collect::<Vec<_>>(),
            [
                (Some(3), Some(Trigger::Close)),
                (Some(2), Some(Trigger::Writing)),
                (Some(1), Some(Trigger::Writing)),
            ]
        );
        assert_eq!(
            std::fs::read_to_string(dir.join(&closed.file)).unwrap(),
            "one two three"
        );
    }

    // M5-1 AC-2, AC-4
    #[test]
    fn a_restore_keeps_what_it_replaces() {
        let root = scratch("restore");
        let doc = root.join("Chapter 1.erti.json");
        let dir = root.join("history");
        let t = at("2026-10-13T10-00-00Z");

        std::fs::write(&doc, "yesterday").unwrap();
        let old = take(&dir, &doc, Trigger::Close, Some(1), t - DAY)
            .unwrap()
            .unwrap();
        std::fs::write(&doc, "today, and much more").unwrap();

        let before = restore(&dir, &doc, &old.file, Some(4), t).unwrap().unwrap();
        assert_eq!(before.trigger, Some(Trigger::BeforeRestore));
        assert_eq!(std::fs::read_to_string(&doc).unwrap(), "yesterday");
        assert_eq!(
            std::fs::read_to_string(dir.join(&before.file)).unwrap(),
            "today, and much more"
        );

        // Restoring that one undoes the restore. Same second: the next is used.
        let undone = restore(&dir, &doc, &before.file, Some(1), t)
            .unwrap()
            .unwrap();
        assert_eq!(undone.file, name_for(t + 1));
        assert_eq!(
            std::fs::read_to_string(&doc).unwrap(),
            "today, and much more"
        );

        // Only a snapshot's name is accepted.
        for bad in ["../Chapter 1.erti.json", "snapshots.json"] {
            let err = restore(&dir, &doc, bad, None, t).unwrap_err();
            assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
        }
    }

    // M5-1 AC-4
    #[test]
    fn a_restore_that_cannot_keep_the_current_state_does_nothing() {
        let root = scratch("restore-refused");
        let doc = root.join("Chapter 1.erti.json");
        let dir = root.join("history");
        let t = at("2026-10-13T10-00-00Z");
        std::fs::write(&doc, "old").unwrap();
        let old = take(&dir, &doc, Trigger::Close, None, t - DAY)
            .unwrap()
            .unwrap();
        std::fs::write(&doc, "new").unwrap();
        // Where the next snapshot would go is taken by a folder.
        std::fs::create_dir_all(dir.join(name_for(t)).join("x")).unwrap();
        std::fs::create_dir_all(dir.join(format!(".{}.partial", name_for(t + 1)))).unwrap();

        assert!(restore(&dir, &doc, &old.file, None, t).is_err());
        assert_eq!(std::fs::read_to_string(&doc).unwrap(), "new");
    }

    // M5-1 AC-3
    #[test]
    fn thinning_deletes_files_and_their_labels_only() {
        let root = scratch("thin");
        let dir = root.join(".erti").join("history").join("Chapter 1");
        std::fs::create_dir_all(&dir).unwrap();
        let now = at("2026-10-13T10-00-00Z");
        for t in [now - 60, now - 2 * DAY + 1800, now - 2 * DAY + 600] {
            std::fs::write(dir.join(name_for(t)), "x").unwrap();
        }
        let mut index = Index::default();
        index.snapshots.insert(
            name_for(now - 2 * DAY + 600),
            Entry {
                trigger: Some("close".into()),
                words: Some(9),
            },
        );
        index.snapshots.insert(
            name_for(now - 60),
            Entry {
                trigger: Some("a trigger from a later Erti".into()),
                words: Some(7),
            },
        );
        write_atomic(&dir.join(INDEX), &serde_json::to_vec(&index).unwrap()).unwrap();
        std::fs::write(dir.join("notes.txt"), "mine").unwrap();

        assert_eq!(thin_project(&root, now), 1);
        let history = list(&dir);
        assert_eq!(
            history
                .snapshots
                .iter()
                .map(|s| s.taken_at)
                .collect::<Vec<_>>(),
            [now - 60, now - 2 * DAY + 1800]
        );
        // Unknown to this build, but its words are kept.
        assert_eq!(history.snapshots[0].trigger, None);
        assert_eq!(history.snapshots[0].words, Some(7));
        assert!(!read_index(&dir)
            .snapshots
            .contains_key(&name_for(now - 2 * DAY + 600)));
        assert!(dir.join("notes.txt").exists());
    }

    // M5-1 AC-4
    #[test]
    fn clearing_old_snapshots_says_how_many_went() {
        let root = scratch("clear");
        let dir = root.join("history");
        std::fs::create_dir_all(&dir).unwrap();
        let now = at("2026-10-13T10-00-00Z");
        for t in [now, now - 89 * DAY, now - 91 * DAY, now - 400 * DAY] {
            std::fs::write(dir.join(name_for(t)), "x").unwrap();
        }
        assert_eq!(clear_before(&dir, now - 90 * DAY).unwrap(), 2);
        assert_eq!(list(&dir).snapshots.len(), 2);
        assert_eq!(clear_before(&dir, now - 90 * DAY).unwrap(), 0);
    }

    #[test]
    fn a_manuscripts_history_folder_is_its_name() {
        assert_eq!(stem_of("Chapter 1.erti.json"), Some("Chapter 1"));
        assert_eq!(stem_of("magnum_opus.json"), Some("magnum_opus"));
        for name in [".erti.json", "..erti.json", "notes.json", "x.pdf"] {
            assert_eq!(stem_of(name), None, "{name}");
        }
    }
}
