//! A manuscript's own file: renamed, duplicated, or moved to the trash (M5-7,
//! docs/ux.md UX-9).
//!
//! Here rather than in the webview because each is more than one step on disk,
//! and the webview has no `remove` or `rename` (M1a-4): a manuscript only ever
//! leaves the project through these, and only from the open project's own
//! folder (`history::locate`).
//!
//! - **Rename** moves the manuscript, then its history, so History still
//!   finds it under the new name. If the history can't move, the manuscript
//!   takes its old name back.
//! - **Duplicate** writes a copy beside it, "Chapter 1 copy", never over a
//!   file that's there. The copy starts a history of its own.
//! - **Delete** moves the file to the system's trash, from which it can be put
//!   back, and leaves its history where it is.

use std::io::{self, Write};
use std::path::{Path, PathBuf};

use crate::db::DbState;
use crate::history::{self, locate, stem_of};
use crate::ipc::{AppError, ErrorKind};

/// Erti's manuscripts end in this; the document from before 1.0 doesn't.
const EXTENSION: &str = ".erti.json";
/// What the document from before 1.0 is called on screen.
const LEGACY_TITLE: &str = "Untitled document";

fn already_here(title: &str) -> AppError {
    AppError::new(
        ErrorKind::Conflict,
        format!("A document called “{title}” is already here. Choose another name."),
    )
}

/// A bare manuscript file name, such as `Chapter 2.erti.json`: no folders,
/// and the extension that makes it one. The webview checks the rest of what
/// makes a good name (`toDocumentFileName`); this is what keeps it a name.
fn manuscript_name(file_name: &str) -> Result<&str, AppError> {
    let invalid = || AppError::new(ErrorKind::InvalidInput, "That isn't a name for a document.");
    // A colon too: `C:x` is drive-relative on Windows, and `x:y` a stream.
    if file_name.contains(['/', '\\', ':', '\0']) {
        return Err(invalid());
    }
    let stem = file_name.strip_suffix(EXTENSION).ok_or_else(invalid)?;
    stem_of(file_name)
        .filter(|s| *s == stem)
        .ok_or_else(invalid)
}

/// A manuscript of the open project that exists, and its history folder.
async fn existing(state: &DbState, document: &str) -> Result<(PathBuf, PathBuf), AppError> {
    let (manuscript, history) = locate(state, document).await?;
    match tokio::fs::symlink_metadata(&manuscript).await {
        Ok(meta) if meta.is_file() => Ok((manuscript, history)),
        Ok(_) => Err(AppError::new(
            ErrorKind::InvalidInput,
            "That isn't a manuscript in this project.",
        )),
        Err(e) => Err(AppError::from_io(&e, &manuscript)),
    }
}

/// Whether two paths are one file, as a case-insensitive disk sees
/// `chapter 1` and `Chapter 1`.
fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Rename `from` to `to`, never over a file at `to`.
///
/// `std::fs::rename` replaces whatever is at `to`, on every platform, so a
/// file another program wrote there after a check (a sync client bringing a
/// co-author's chapter down, say) would be lost. A hard link can't be made
/// over a file: linking and then removing the old name is the check and the
/// move in one step. Where a disk has no hard links (FAT, some network
/// shares), checking first is the best there is.
fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    match std::fs::hard_link(from, to) {
        Ok(()) => std::fs::remove_file(from).inspect_err(|_| {
            let _ = std::fs::remove_file(to);
        }),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Err(e),
        Err(_) if to.exists() => Err(io::ErrorKind::AlreadyExists.into()),
        Err(_) => std::fs::rename(from, to),
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| AppError::internal(format!("the document task failed: {e}")))?
}

/// Rename a manuscript to `file_name`, beside it, and move its history with
/// it. Returns its new path.
#[tauri::command]
#[specta::specta]
pub async fn rename_document(
    state: tauri::State<'_, DbState>,
    document: String,
    file_name: String,
) -> Result<String, AppError> {
    rename_document_in(&state, document, file_name).await
}

pub async fn rename_document_in(
    state: &DbState,
    document: String,
    file_name: String,
) -> Result<String, AppError> {
    let stem = manuscript_name(&file_name)?.to_owned();
    let (manuscript, history) = existing(state, &document).await?;
    let root = manuscript
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| AppError::internal("a manuscript with no folder"))?;
    let target = root.join(&file_name);

    blocking(move || {
        // A case-only rename is the same file on macOS and Windows, and fine:
        // the one rename that's allowed to land on something already there.
        let case_only = same_file(&target, &manuscript);
        let rename = |from: &Path, to: &Path| {
            if case_only {
                std::fs::rename(from, to)
            } else {
                rename_no_replace(from, to)
            }
        };
        rename(&manuscript, &target).map_err(|e| match e.kind() {
            io::ErrorKind::AlreadyExists => already_here(&stem),
            _ => AppError::from_io(&e, &manuscript),
        })?;

        let moved = history::root_of(&root).join(&stem);
        if let Err(e) = history::move_to(&history, &moved) {
            log::warn!("could not move a document's history: {e}");
            // Its history is the point of keeping it: the old name back, so
            // History still finds every snapshot.
            if let Err(back) = rename(&target, &manuscript) {
                log::error!("could not put a document's name back: {back}");
            }
            return Err(AppError::new(
                ErrorKind::Io,
                format!(
                    "Its history couldn’t be moved, so it kept its name. {}",
                    crate::fs_errors::describe(&e, &history)
                ),
            ));
        }
        Ok(target.to_string_lossy().into_owned())
    })
    .await
}

/// Copy a manuscript to "<name> copy" beside it (or "copy 2", and on).
/// Returns the copy's path.
#[tauri::command]
#[specta::specta]
pub async fn duplicate_document(
    state: tauri::State<'_, DbState>,
    document: String,
) -> Result<String, AppError> {
    duplicate_document_in(&state, document).await
}

pub async fn duplicate_document_in(state: &DbState, document: String) -> Result<String, AppError> {
    let (manuscript, _) = existing(state, &document).await?;
    blocking(move || {
        let bytes = std::fs::read(&manuscript).map_err(|e| AppError::from_io(&e, &manuscript))?;
        let name = manuscript
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        let title = match name.strip_suffix(EXTENSION) {
            Some(stem) => stem,
            None => LEGACY_TITLE,
        };
        let root = manuscript.parent().unwrap_or(Path::new(""));

        for n in 1..1000 {
            let copy = if n == 1 {
                format!("{title} copy{EXTENSION}")
            } else {
                format!("{title} copy {n}{EXTENSION}")
            };
            let path = root.join(copy);
            // Never over a file that's there: `create_new` asks the disk
            // itself, which a check beforehand can't.
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(mut file) => {
                    file.write_all(&bytes)
                        .and_then(|_| file.sync_all())
                        .map_err(|e| {
                            let _ = std::fs::remove_file(&path);
                            AppError::from_io(&e, &path)
                        })?;
                    return Ok(path.to_string_lossy().into_owned());
                }
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(AppError::from_io(&e, &path)),
            }
        }
        Err(already_here(&format!("{title} copy")))
    })
    .await
}

/// Move a manuscript to the system's trash. Its history stays (UX-9).
#[tauri::command]
#[specta::specta]
pub async fn trash_document(
    state: tauri::State<'_, DbState>,
    document: String,
) -> Result<(), AppError> {
    trash_document_in(&state, document, |path| {
        trash::delete(path).map_err(|e| e.to_string())
    })
    .await
}

/// `discard` is what moves it: the system's trash in the app, and a folder of
/// the test's own in tests, which shouldn't fill the trash of whoever runs them.
pub async fn trash_document_in(
    state: &DbState,
    document: String,
    discard: impl FnOnce(&Path) -> Result<(), String> + Send + 'static,
) -> Result<(), AppError> {
    let (manuscript, _) = existing(state, &document).await?;
    blocking(move || {
        discard(&manuscript).map_err(|e| {
            log::warn!("could not move a document to the trash: {e}");
            AppError::new(
                ErrorKind::Io,
                "It couldn’t be moved to the trash, so it’s still here.",
            )
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::rename_no_replace;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("erti-documents-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_rename_never_lands_on_a_file_that_appeared_meanwhile() {
        let dir = scratch("no-replace");
        let (ours, theirs) = (
            dir.join("Chapter 1.erti.json"),
            dir.join("Methods.erti.json"),
        );
        std::fs::write(&ours, "ours").unwrap();
        std::fs::write(&theirs, "theirs").unwrap();

        let refused = rename_no_replace(&ours, &theirs).unwrap_err();

        assert_eq!(refused.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read_to_string(&ours).unwrap(), "ours");
        assert_eq!(std::fs::read_to_string(&theirs).unwrap(), "theirs");
    }

    #[test]
    fn a_rename_to_a_free_name_moves_the_file() {
        let dir = scratch("free");
        let (from, to) = (
            dir.join("Chapter 1.erti.json"),
            dir.join("Methods.erti.json"),
        );
        std::fs::write(&from, "ours").unwrap();

        rename_no_replace(&from, &to).unwrap();

        assert!(!from.exists());
        assert_eq!(std::fs::read_to_string(&to).unwrap(), "ours");
    }
}
