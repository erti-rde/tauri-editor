//! The library file itself: its backups listed, one restored, the whole
//! library moved to another folder (M5-10, ADR 008).
//!
//! Each step that replaces or moves the file closes the library first and
//! opens it again after, and each one is undone if the next fails: the person
//! should never be left with no library open, or with a setting pointing at a
//! file that isn't there.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use super::{backup, BackupReport, DbState};
use crate::ipc::{AppError, Classify, ErrorKind};

/// One backup, as Settings › Library lists it.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    /// The file's name in the backup folder, which `restore` is given back.
    pub name: String,
    /// When it was written, in milliseconds since 1970.
    pub taken_at: f64,
    /// The schema it was taken before upgrading from, for a pre-migration copy.
    pub before_version: Option<u32>,
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

fn millis(time: SystemTime) -> f64 {
    time.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
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

/// The library's backups, newest first.
pub async fn backups(state: &DbState) -> Result<LibraryBackups, AppError> {
    let path = state.library_path().await?;
    let folder = backup::dir_for(&path);
    let mut backups: Vec<BackupFile> = backup::list(&folder)
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
                name,
            })
        })
        .collect();
    backups.sort_by(|a, b| b.taken_at.total_cmp(&a.taken_at));
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

/// Put a backup in the library's place, keeping the library it replaces.
///
/// The library as it stands is copied into the backup folder first, with
/// `VACUUM INTO` while it's still open, so the copy is whole whatever the log
/// holds. Nothing is replaced unless that copy was written. A backup that then
/// won't open is taken back out, and the library it replaced put back.
pub async fn restore(
    state: &DbState,
    name: &str,
    report: BackupReport,
) -> Result<Restored, AppError> {
    let path = state.library_path().await?;
    let folder = backup::dir_for(&path);
    // Only a name the folder lists: a name is never a path to somewhere else.
    if !backup::list(&folder).iter().any(|n| n == name) {
        return Err(AppError::new(
            ErrorKind::NotFound,
            "That backup isn't in the backup folder any more. Open the folder to see what's there.",
        ));
    }
    let source = folder.join(name);

    let pool = state.library().await?;
    let replaced = replaced_name(SystemTime::now());
    sqlx::query("VACUUM INTO ?")
        .bind(folder.join(&replaced).to_string_lossy().as_ref())
        .execute(&pool)
        .await
        .map_err(|e| {
            AppError::new(
                ErrorKind::Database,
                format!("Couldn't keep a copy of the library first, so nothing was restored: {e}"),
            )
        })?;
    drop(pool);

    state.close_library().await;
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
    partial.push(".restoring");
    let partial = PathBuf::from(partial);
    tokio::fs::copy(from, &partial)
        .await
        .map_err(|e| crate::fs_errors::describe(&e, from))?;
    tokio::fs::rename(&partial, to)
        .await
        .map_err(|e| crate::fs_errors::describe(&e, to))
}

/// Move one file, copying when it's going to another disk.
async fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if tokio::fs::rename(from, to).await.is_ok() {
        return Ok(());
    }
    tokio::fs::copy(from, to).await?;
    tokio::fs::remove_file(from).await
}

/// Move the backups across with the library, leaving any whose name is
/// already taken there. Returns how many were left behind.
async fn move_backups(from: &Path, to: &Path) -> usize {
    if from == to {
        return 0;
    }
    let names = backup::list(from);
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

    // A consistent copy, written under a temporary name like a backup's.
    let pool = state.library().await?;
    let mut partial = to.as_os_str().to_owned();
    partial.push(".moving");
    let partial = PathBuf::from(partial);
    let _ = tokio::fs::remove_file(&partial).await;
    sqlx::query("VACUUM INTO ?")
        .bind(partial.to_string_lossy().as_ref())
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())
        .or_database()?;
    drop(pool);
    if let Err(e) = tokio::fs::rename(&partial, &to).await {
        let _ = tokio::fs::remove_file(&partial).await;
        return Err(AppError::from_io(&e, &to));
    }

    if let Err(e) = remember(&to) {
        let _ = tokio::fs::remove_file(&to).await;
        return Err(AppError::new(
            ErrorKind::Io,
            format!("Couldn't record where the library is now, so it stayed where it was: {e}"),
        ));
    }

    state.close_library().await;
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
}
