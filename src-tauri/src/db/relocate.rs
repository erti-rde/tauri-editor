//! The library file itself: its backups listed, one restored, the whole
//! library moved to another folder (M5-10, ADR 008).
//!
//! Each step that replaces or moves the file closes the library first and
//! opens it again after, and each one is undone if the next fails: the person
//! should never be left with no library open, or with a setting pointing at a
//! file that isn't there.
//!
//! The file is copied only once it's closed. A copy taken while it's open
//! (`VACUUM INTO`, as the backups are) holds the library as it was when the
//! copy began, and an import committing meanwhile lands only in the file
//! that's then replaced or deleted.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use super::{backup, BackupReport, DbState};
use crate::ipc::{AppError, ErrorKind};

/// One backup, as Settings › Library lists it.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    /// The file's name in the backup folder, which `restore` is given back.
    pub name: String,
    /// When it was written, in milliseconds since 1970.
    #[specta(type = specta_typescript::Number)]
    pub taken_at: u64,
    /// The schema it was taken before upgrading from, for a pre-migration copy.
    pub before_version: Option<u32>,
    /// The library a restore replaced, rather than a backup: kept, never
    /// pruned, and restored like one to undo that restore.
    pub replaced: bool,
}

/// The library's file and its backups.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LibraryBackups {
    pub path: String,
    pub folder: String,
    /// Newest first.
    pub backups: Vec<BackupFile>,
    pub keep_days: u32,
    pub keep_weeks: u32,
}

/// What a restore left behind, for the toast that says so.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Restored {
    /// The library as it was just before, kept in the backup folder.
    pub replaced: String,
}

fn millis(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

/// Write-ahead log and shared-memory files beside a database.
fn sidecars(path: &Path) -> [PathBuf; 2] {
    let name = path.as_os_str().to_owned();
    let with = |suffix: &str| {
        let mut n = name.clone();
        n.push(suffix);
        PathBuf::from(n)
    };
    [with("-wal"), with("-shm")]
}

async fn remove_sidecars(path: &Path) {
    for sidecar in sidecars(path) {
        let _ = tokio::fs::remove_file(sidecar).await;
    }
}

/// `library-replaced-YYYY-MM-DD-HHMMSS.db`, or `…-HHMMSS-2.db` and on, as
/// `replaced_name` and `unused_replaced_name` write it.
fn is_replaced_name(name: &str) -> bool {
    let Some(rest) = name
        .strip_prefix("library-replaced-")
        .and_then(|rest| rest.strip_suffix(".db"))
    else {
        return false;
    };
    let (stamp, count) = rest.split_at_checked(17).unwrap_or((rest, ""));
    stamp.len() == 17
        && stamp.chars().all(|c| c.is_ascii_digit() || c == '-')
        && (count.is_empty()
            || count
                .strip_prefix('-')
                .is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit())))
}

/// What the backup folder keeps: the backups, and the libraries restores
/// replaced. Names read from the folder, so never a path elsewhere.
fn kept(folder: &Path) -> Vec<String> {
    let mut names = backup::list(folder);
    names.extend(
        std::fs::read_dir(folder)
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok()?.file_name().into_string().ok())
            .filter(|n| is_replaced_name(n)),
    );
    names
}

/// The library's backups, and the libraries restores replaced, newest first.
pub async fn backups(state: &DbState) -> Result<LibraryBackups, AppError> {
    let path = state.library_path().await?;
    let folder = backup::dir_for(&path);
    let mut backups: Vec<BackupFile> = kept(&folder)
        .into_iter()
        .filter_map(|name| {
            let modified = std::fs::metadata(folder.join(&name))
                .ok()?
                .modified()
                .ok()?;
            Some(BackupFile {
                before_version: backup::before_version_of_name(&name)
                    .and_then(|v| u32::try_from(v).ok()),
                taken_at: millis(modified),
                replaced: is_replaced_name(&name),
                name,
            })
        })
        .collect();
    backups.sort_by_key(|b| std::cmp::Reverse(b.taken_at));
    Ok(LibraryBackups {
        path: path.to_string_lossy().into_owned(),
        folder: folder.to_string_lossy().into_owned(),
        backups,
        keep_days: backup::KEEP_DAYS as u32,
        keep_weeks: backup::KEEP_WEEKS as u32,
    })
}

/// `library-replaced-YYYY-MM-DD-HHMMSS.db`, in UTC like the backups' names.
fn replaced_name(now: SystemTime) -> String {
    let secs = now
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let day = backup::day_of(now);
    let of_day = secs % (24 * 60 * 60);
    format!(
        "library-replaced-{}-{:02}{:02}{:02}.db",
        backup::date_string(day),
        of_day / 3600,
        of_day / 60 % 60,
        of_day % 60
    )
}

/// Close the library, and make the file on disk all of it.
///
/// Closing waits for every connection, those mid-write too. The last one to
/// close would write the log into the file, but the pool closes them together
/// and each can see another still open, so the log is often left beside it. A
/// connection opened alone writes it in for certain (`TRUNCATE` empties it),
/// and a copy of the file alone is then the whole library.
async fn close_whole(state: &DbState, path: &Path) -> Result<(), String> {
    use sqlx::{ConnectOptions, Connection};

    state.close_library().await;
    let mut alone = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(path)
        .connect()
        .await
        .map_err(|e| e.to_string())?;
    let (busy, _, _): (i64, i64, i64) = sqlx::query_as("PRAGMA wal_checkpoint(TRUNCATE)")
        .fetch_one(&mut alone)
        .await
        .map_err(|e| e.to_string())?;
    alone.close().await.map_err(|e| e.to_string())?;
    let [wal, _] = sidecars(path);
    let left = tokio::fs::metadata(&wal).await.map_or(0, |log| log.len());
    if busy != 0 || left > 0 {
        return Err("its log couldn't be written into it".into());
    }
    Ok(())
}

/// A name for the library a restore replaces that no copy in `folder` has:
/// undoing a restore straight away is another restore in the same second, and
/// its copy mustn't overwrite the one it's restoring from.
fn unused_replaced_name(folder: &Path, now: SystemTime) -> String {
    let first = replaced_name(now);
    let stem = first.trim_end_matches(".db").to_owned();
    std::iter::once(first)
        .chain((2..).map(|n| format!("{stem}-{n}.db")))
        .find(|name| !folder.join(name).exists())
        .unwrap_or_default()
}

/// Put a backup in the library's place, keeping the library it replaces.
///
/// The library is closed and copied into the backup folder first, and
/// nothing is replaced unless that copy was written. A backup that then won't
/// open is taken back out, and the library it replaced put back.
pub async fn restore(
    state: &DbState,
    name: &str,
    report: BackupReport,
) -> Result<Restored, AppError> {
    let path = state.library_path().await?;
    let folder = backup::dir_for(&path);
    // Only a name the folder lists: a name is never a path to somewhere else.
    if !kept(&folder).iter().any(|n| n == name) {
        return Err(AppError::new(
            ErrorKind::NotFound,
            "That backup isn't in the backup folder any more. Open the folder to see what's there.",
        ));
    }
    let source = folder.join(name);

    let replaced = unused_replaced_name(&folder, SystemTime::now());
    let kept_copy = match close_whole(state, &path).await {
        Ok(()) => put_in_place(&path, &folder.join(&replaced)).await,
        Err(e) => Err(e),
    };
    if let Err(e) = kept_copy {
        let reopened = state.open_library_reporting(&path, report).await;
        return Err(AppError::new(
            ErrorKind::Database,
            format!(
                "Couldn't keep a copy of the library first, so nothing was restored: {e}.{}",
                if reopened.is_ok() {
                    ""
                } else {
                    " Restart Erti to open it again."
                }
            ),
        ));
    }
    remove_sidecars(&path).await;

    let put = put_in_place(&source, &path).await;
    let opened = match put {
        Ok(()) => state
            .open_library_reporting(&path, report.clone())
            .await
            .map_err(|e| format!("that backup couldn't be opened: {e}")),
        Err(e) => Err(e),
    };

    if let Err(why) = opened {
        // Back as it was: the copy taken a moment ago is the library.
        state.close_library().await;
        remove_sidecars(&path).await;
        let back = put_in_place(&folder.join(&replaced), &path).await;
        let reopened = state.open_library_reporting(&path, report).await;
        return Err(match (back, reopened) {
            (Ok(()), Ok(())) => AppError::new(
                ErrorKind::Io,
                format!("Nothing was restored: {why}. Your library is as it was."),
            ),
            _ => AppError::new(
                ErrorKind::Io,
                format!(
                    "Nothing was restored: {why}. Your library is kept as {replaced} in the backup folder; restart Erti to open it again."
                ),
            ),
        });
    }

    Ok(Restored { replaced })
}

/// Copy `from` over `to`, through a temporary name so `to` is never half
/// written.
async fn put_in_place(from: &Path, to: &Path) -> Result<(), String> {
    let mut partial = to.as_os_str().to_owned();
    partial.push(".copying");
    let partial = PathBuf::from(partial);
    let copied = match tokio::fs::copy(from, &partial).await {
        Ok(_) => tokio::fs::rename(&partial, to)
            .await
            .map_err(|e| crate::fs_errors::describe(&e, to)),
        Err(e) => Err(crate::fs_errors::describe(&e, from)),
    };
    if copied.is_err() {
        let _ = tokio::fs::remove_file(&partial).await;
    }
    copied
}

/// Copy a backup, keeping the time it was taken.
///
/// A copy is dated now, and a backup's date is what the restore list shows
/// and what the next daily backup is judged by (`backup::daily_due`): a week
/// of backups copied to another disk would all read as taken today, and none
/// would be taken tomorrow.
async fn copy_dated(from: &Path, to: &Path) -> std::io::Result<()> {
    let taken = tokio::fs::metadata(from).await?.modified()?;
    tokio::fs::copy(from, to).await?;
    let dated = std::fs::File::options()
        .write(true)
        .open(to)
        .and_then(|file| file.set_modified(taken));
    if dated.is_err() {
        let _ = tokio::fs::remove_file(to).await;
    }
    dated
}

/// Move one file, copying when it's going to another disk.
async fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if tokio::fs::rename(from, to).await.is_ok() {
        return Ok(());
    }
    copy_dated(from, to).await?;
    tokio::fs::remove_file(from).await
}

/// Move the backups across with the library, leaving any whose name is
/// already taken there. Returns how many were left behind.
async fn move_backups(from: &Path, to: &Path) -> usize {
    if from == to {
        return 0;
    }
    let names = kept(from);
    if names.is_empty() {
        return 0;
    }
    if tokio::fs::create_dir_all(to).await.is_err() {
        return names.len();
    }
    let mut left = 0;
    for name in names {
        let target = to.join(&name);
        if tokio::fs::try_exists(&target).await.unwrap_or(true)
            || move_file(&from.join(&name), &target).await.is_err()
        {
            left += 1;
        }
    }
    // Gone if it's empty now; kept, with whatever else is in it, if not.
    let _ = tokio::fs::remove_dir(from).await;
    left
}

/// Where a moved library ends up, and what didn't come with it.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Moved {
    pub path: String,
    /// Backups that stayed in the old backup folder, because the new one
    /// already held a file of the same name or the move failed.
    pub backups_left: u32,
}

/// Move the library, and its backups, into `folder` (already authorised),
/// then open it there.
///
/// `remember` records the new path where the next launch reads it (the
/// `libraryPath` setting). It's called once the copy is written and before
/// the old file goes, so a failure on either side leaves one library, at the
/// path the setting names.
pub async fn relocate(
    state: &DbState,
    folder: &Path,
    report: BackupReport,
    remember: impl Fn(&Path) -> Result<(), String>,
) -> Result<Moved, AppError> {
    let from = state.library_path().await?;
    let file_name = from
        .file_name()
        .map(|n| n.to_owned())
        .unwrap_or_else(|| "library.db".into());
    let to = folder.join(file_name);

    let from_canonical = tokio::fs::canonicalize(&from).await.unwrap_or(from.clone());
    if to == from_canonical || to == from {
        return Ok(Moved {
            path: from.to_string_lossy().into_owned(),
            backups_left: 0,
        });
    }
    if tokio::fs::try_exists(&to).await.unwrap_or(true) {
        return Err(AppError::new(
            ErrorKind::Conflict,
            format!(
                "There's already a {} in that folder. Choose another folder, or move that file out first.",
                to.file_name().unwrap_or_default().to_string_lossy()
            ),
        ));
    }

    // Closed, so the copy is all of it; until it's recorded, the library
    // goes back to being open where it was.
    let copied = match close_whole(state, &from).await {
        Ok(()) => put_in_place(&from, &to).await.map_err(|e| {
            format!("Couldn't copy the library there, so it stayed where it was: {e}")
        }),
        Err(e) => Err(format!(
            "Couldn't close the library to move it, so it stayed where it was: {e}"
        )),
    };
    let recorded = copied.and_then(|()| {
        remember(&to).map_err(|e| {
            format!("Couldn't record where the library is now, so it stayed where it was: {e}")
        })
    });
    if let Err(why) = recorded {
        let _ = tokio::fs::remove_file(&to).await;
        let reopened = state.open_library_reporting(&from, report).await;
        return Err(AppError::new(
            ErrorKind::Io,
            if reopened.is_ok() {
                why
            } else {
                format!("{why} Restart Erti to open it again.")
            },
        ));
    }

    let left = move_backups(&backup::dir_for(&from), &backup::dir_for(&to)).await;

    if let Err(e) = state.open_library_reporting(&to, report.clone()).await {
        // Back to the old file, which is still there, and the old setting.
        move_backups(&backup::dir_for(&to), &backup::dir_for(&from)).await;
        let _ = remember(&from);
        let _ = state.open_library_reporting(&from, report).await;
        let _ = tokio::fs::remove_file(&to).await;
        remove_sidecars(&to).await;
        return Err(AppError::new(
            ErrorKind::Database,
            format!("The moved library couldn't be opened, so it stayed where it was: {e}"),
        ));
    }

    // The library is open at its new path; the old file is only a copy now.
    if let Err(e) = tokio::fs::remove_file(&from).await {
        log::warn!("Moved the library, but couldn't remove the old file: {e}");
    }
    remove_sidecars(&from).await;

    Ok(Moved {
        path: to.to_string_lossy().into_owned(),
        backups_left: u32::try_from(left).unwrap_or(u32::MAX),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_replaced_library_is_named_for_the_moment_in_utc() {
        let at = UNIX_EPOCH + std::time::Duration::from_secs(1_760_000_000 + 3_723);
        let day = backup::date_string(backup::day_of(at));
        let name = replaced_name(at);
        assert!(name.starts_with(&format!("library-replaced-{day}-")));
        // Never read back as a backup, so pruning leaves it alone.
        assert_eq!(backup::day_of_name(&name), None);
    }

    #[test]
    fn only_the_names_a_restore_writes_are_read_as_replaced_libraries() {
        assert!(is_replaced_name(&replaced_name(SystemTime::now())));
        assert!(is_replaced_name("library-replaced-2026-10-20-091200.db"));
        assert!(is_replaced_name("library-replaced-2026-10-20-091200-2.db"));
        for name in [
            "library-replaced-.db",
            "library-replaced-2026-10-20-091200.db-wal",
            "library-replaced-../../x.db",
            "library-replaced-2026-10-20-09120x.db",
            "library-replaced-2026-10-20-091200-.db",
            "library-replaced-2026-10-20-091200-x.db",
            "library-2026-10-20.db",
        ] {
            assert!(!is_replaced_name(name), "{name}");
        }
    }

    // M5-10 AC-1: what a move to another disk does to each backup.
    #[tokio::test]
    async fn a_copied_backup_keeps_the_time_it_was_taken() {
        let dir = std::env::temp_dir().join(format!("erti-copy-dated-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let from = dir.join("library-2026-10-14.db");
        std::fs::write(&from, "a backup").unwrap();
        let taken = SystemTime::now() - std::time::Duration::from_secs(6 * 24 * 60 * 60);
        std::fs::File::options()
            .write(true)
            .open(&from)
            .unwrap()
            .set_modified(taken)
            .unwrap();

        let to = dir.join("copy.db");
        copy_dated(&from, &to).await.unwrap();

        let modified = std::fs::metadata(&to).unwrap().modified().unwrap();
        assert_eq!(millis(modified) / 1000, millis(taken) / 1000);
        assert_eq!(std::fs::read_to_string(&to).unwrap(), "a backup");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
