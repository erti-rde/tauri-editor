//! Which paths the webview may ask Rust to touch (M1a-3, SEC-1, threat T2).
//!
//! The commands that take a path used to accept any path at all, so a script
//! that got into the webview (a hostile manuscript, T1) could read any file the
//! user can: `read_pdf_file("~/.ssh/id_rsa")` returned it base64-encoded. Now a
//! path is accepted only if, after resolving `..` and symlinks, it lies inside:
//!
//! - the open project folder;
//! - a folder or file the user picked in a dialog this session, which the
//!   dialog plugin announces through the fs scope (`grant`); or
//! - a path the library has recorded a paper at (`locations`), so a paper
//!   from another project still opens from the Notes panel.
//!
//! Anything else is refused with the same words whether or not it exists, so a
//! refusal can't be used to find out what is on the disk.

use std::path::{Component, Path, PathBuf};
use std::sync::RwLock;

use crate::db::DbState;
use crate::ipc::{AppError, ErrorKind};

/// What a refused path is told.
pub const OUTSIDE: &str = "Erti can only open files inside the project folder or your library.";

/// What a folder that can't be opened as a project is told.
pub const NOT_PICKED: &str =
    "Erti can't open this folder yet. Choose it with \u{201c}Open another folder\u{2026}\u{201d} to let Erti use it.";

fn outside() -> AppError {
    AppError::new(ErrorKind::PermissionDenied, OUTSIDE)
}

/// Paths the user has handed to Erti through a dialog this session.
///
/// Kept canonical, so a grant and a later request compare the same way however
/// each was spelt. Session-only by design: a grant is the user's say-so for
/// what they're doing now, and a project they return to is recognised by its
/// `.erti` folder instead (`may_open_project`).
#[derive(Default)]
pub struct Grants(RwLock<Vec<PathBuf>>);

impl Grants {
    pub fn grant(&self, path: &Path) {
        let Ok(canonical) = std::fs::canonicalize(path) else {
            return;
        };
        let mut grants = self.0.write().unwrap_or_else(|e| e.into_inner());
        if !grants.contains(&canonical) {
            grants.push(canonical);
        }
    }

    /// Is `canonical` a granted file, or inside a granted folder?
    pub fn cover(&self, canonical: &Path) -> bool {
        let grants = self.0.read().unwrap_or_else(|e| e.into_inner());
        grants.iter().any(|granted| canonical.starts_with(granted))
    }
}

/// Forms refused before the filesystem is asked anything.
///
/// A relative path would resolve against wherever the process happens to be.
/// On Windows, a UNC path (`\\server\share`, or the `\\?\` and `\\.\` device
/// forms) reaches the network or raw devices, and a drive-relative one
/// (`C:notes.txt`) resolves against that drive's current directory. The checks
/// are on the text, so they hold on every platform and are tested on all.
pub fn refused_form(path: &str) -> bool {
    let bytes = path.as_bytes();
    let drive = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    let drive_relative = drive && !matches!(bytes.get(2), Some(b'\\') | Some(b'/'));

    path.is_empty()
        || path.contains('\0')
        || path.starts_with(r"\\")
        || path.starts_with("//")
        || drive_relative
        || (!drive && !Path::new(path).is_absolute())
}

/// `..` and `.` resolved on the text alone, for a path that doesn't exist yet
/// and so can't be canonicalised.
fn normalise(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

/// The canonical form of a path that may not exist: its nearest existing
/// ancestor canonicalised, with the rest appended. Enough to say whether a
/// missing file *would* have been inside a root.
fn canonical_or_nearest(path: &Path) -> PathBuf {
    let path = normalise(path);
    let mut existing = path.as_path();
    let mut rest = Vec::new();
    loop {
        if let Ok(canonical) = std::fs::canonicalize(existing) {
            return rest
                .iter()
                .rev()
                .fold(canonical, |acc, part| acc.join(part));
        }
        match (existing.parent(), existing.file_name()) {
            (Some(parent), Some(name)) => {
                rest.push(name.to_owned());
                existing = parent;
            }
            _ => return path,
        }
    }
}

async fn project_root(db: &DbState) -> Option<PathBuf> {
    let root = db.project_root().await.ok()?;
    tokio::fs::canonicalize(root).await.ok()
}

/// Inside the project folder or a grant: the roots that don't need the library.
async fn under_a_root(db: &DbState, canonical: &Path) -> bool {
    if db.grants.cover(canonical) {
        return true;
    }
    matches!(project_root(db).await, Some(root) if canonical.starts_with(&root))
}

/// A path the library has seen a paper at, as spelt or as canonicalised.
async fn is_recorded_location(db: &DbState, raw: &str, canonical: &Path) -> bool {
    let Ok(library) = db.library().await else {
        return false;
    };
    let canonical = canonical.to_string_lossy();
    sqlx::query_scalar::<_, i64>("SELECT 1 FROM locations WHERE path IN (?, ?) LIMIT 1")
        .bind(raw)
        .bind(canonical.as_ref())
        .fetch_optional(&library)
        .await
        .ok()
        .flatten()
        .is_some()
}

/// The path, canonicalised, if the webview may use it; the refusal otherwise.
///
/// A missing file inside the roots is reported as missing, with the usual
/// advice. A missing file outside them gets the same refusal as a present one.
pub async fn authorise(db: &DbState, path: &str) -> Result<PathBuf, AppError> {
    if refused_form(path) {
        return Err(outside());
    }
    let raw = Path::new(path);

    match tokio::fs::canonicalize(raw).await {
        Ok(canonical) => {
            if under_a_root(db, &canonical).await
                || is_recorded_location(db, path, &canonical).await
            {
                Ok(canonical)
            } else {
                Err(outside())
            }
        }
        Err(error) => {
            let would_be = canonical_or_nearest(raw);
            if under_a_root(db, &would_be).await || is_recorded_location(db, path, &would_be).await
            {
                Err(AppError::from_io(&error, raw))
            } else {
                Err(outside())
            }
        }
    }
}

/// May this folder be opened as a project?
///
/// Yes if the user picked it (or a folder containing it) this session, if it's
/// the project already open, or if Erti has opened it before, which left
/// `.erti/project.db` in it: that is how the recent-projects list reopens a
/// folder without asking again. Without this gate, opening `/` as a project
/// would put the whole disk in scope.
pub async fn may_open_project(db: &DbState, root: &str) -> Result<PathBuf, AppError> {
    if refused_form(root) {
        return Err(AppError::new(ErrorKind::PermissionDenied, NOT_PICKED));
    }
    let canonical = tokio::fs::canonicalize(root)
        .await
        .map_err(|e| AppError::from_io(&e, Path::new(root)))?;

    let opened_before = tokio::fs::try_exists(canonical.join(".erti").join("project.db"))
        .await
        .unwrap_or(false);
    let already_open = project_root(db).await.as_deref() == Some(canonical.as_path());

    if opened_before || already_open || db.grants.cover(&canonical) {
        Ok(canonical)
    } else {
        Err(AppError::new(ErrorKind::PermissionDenied, NOT_PICKED))
    }
}

/// A folder to list: anything `authorise` allows, or a project about to be
/// opened. The landing screen lists a recent project before opening it.
pub async fn authorise_directory(db: &DbState, path: &str) -> Result<PathBuf, AppError> {
    match authorise(db, path).await {
        Ok(canonical) => Ok(canonical),
        Err(refused) if refused.kind == ErrorKind::PermissionDenied => {
            may_open_project(db, path).await.map_err(|_| refused)
        }
        Err(other) => Err(other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("erti-scope-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // M1a-3 AC-3: the Windows forms, checked on the text so every platform runs them.
    #[test]
    fn unc_and_device_paths_are_refused() {
        for path in [
            r"\\server\share\paper.pdf",
            r"\\?\C:\Users\me\paper.pdf",
            r"\\.\PhysicalDrive0",
            "//server/share/paper.pdf",
        ] {
            assert!(refused_form(path), "{path}");
        }
    }

    // M1a-3 AC-3
    #[test]
    fn drive_relative_paths_are_refused() {
        for path in ["C:notes.txt", "c:..\\secret", "D:"] {
            assert!(refused_form(path), "{path}");
        }
        assert!(!refused_form(r"C:\Users\me\paper.pdf"));
        assert!(!refused_form("C:/Users/me/paper.pdf"));
    }

    // M1a-3 AC-3
    #[test]
    fn relative_and_empty_paths_are_refused() {
        for path in ["", "paper.pdf", "../etc/passwd", "./x", "a\0b"] {
            assert!(refused_form(path), "{path:?}");
        }
        assert!(!refused_form("/Users/me/paper.pdf"));
    }

    #[test]
    fn a_missing_file_is_placed_by_its_nearest_existing_folder() {
        let dir = scratch("nearest");
        let canonical = std::fs::canonicalize(&dir).unwrap();
        let missing = dir.join("sub").join("..").join("gone.pdf");
        assert_eq!(canonical_or_nearest(&missing), canonical.join("gone.pdf"));
    }

    #[test]
    fn a_grant_covers_what_is_inside_it_and_nothing_beside_it() {
        let dir = scratch("grants");
        std::fs::create_dir(dir.join("project")).unwrap();
        std::fs::create_dir(dir.join("project-other")).unwrap();
        let root = std::fs::canonicalize(&dir).unwrap();

        let grants = Grants::default();
        grants.grant(&dir.join("project"));

        assert!(grants.cover(&root.join("project")));
        assert!(grants.cover(&root.join("project").join("paper.pdf")));
        // By component, not by string prefix.
        assert!(!grants.cover(&root.join("project-other")));
        assert!(!grants.cover(&root));
    }
}
