//! Turning filesystem refusals into something a researcher can act on.
//!
//! macOS gates Documents, Desktop, Downloads, iCloud Drive and removable
//! volumes behind TCC. An app that has not been granted access gets
//! `PermissionDenied` — surfaced verbatim, that reads `Operation not permitted
//! (os error 1)`, which is indistinguishable from a bug in Erti and tells the
//! user nothing about the checkbox that would fix it.
//!
//! This matters more here than in most apps: `~/Documents` is exactly where
//! academics keep papers, so the default case is the protected one.

use std::io;
use std::path::Path;

/// Describe a filesystem failure in terms of what the user can do about it.
pub fn describe(err: &io::Error, path: &Path) -> String {
    let shown = path.display();

    match err.kind() {
        io::ErrorKind::PermissionDenied => permission_denied(path),
        io::ErrorKind::NotFound => {
            format!("{shown} no longer exists. It may have been moved or renamed.")
        }
        _ => format!("Could not access {shown}: {err}"),
    }
}

#[cfg(target_os = "macos")]
fn permission_denied(path: &Path) -> String {
    // Removable volumes are governed by their own TCC permission, not by Full
    // Disk Access, and the app declares NSRemovableVolumesUsageDescription for
    // exactly this case. Sending those users to Full Disk Access would have
    // them grant something far broader than the app needs, and it is not the
    // switch that unblocks them.
    match access_class(path) {
        Access::ProtectedFolder(folder) => format!(
            "macOS is blocking access to your {folder} folder, where {} lives. \
             Open System Settings > Privacy & Security > Files and Folders, \
             allow Erti access, then try again.",
            path.display()
        ),
        Access::RemovableVolume => format!(
            "macOS is blocking access to the volume holding {}. \
             Open System Settings > Privacy & Security > Removable Volumes, \
             allow Erti access, then try again.",
            path.display()
        ),
        Access::Other => format!(
            "macOS is blocking access to {}. \
             Open System Settings > Privacy & Security > Full Disk Access, \
             allow Erti access, then try again.",
            path.display()
        ),
    }
}

#[cfg(target_os = "macos")]
enum Access {
    ProtectedFolder(&'static str),
    RemovableVolume,
    Other,
}

/// Which permission actually governs this path.
#[cfg(target_os = "macos")]
fn access_class(path: &Path) -> Access {
    if let Some(folder) = protected_folder(path) {
        return Access::ProtectedFolder(folder);
    }
    // External drives and mounted images live under /Volumes.
    if path.starts_with("/Volumes") {
        return Access::RemovableVolume;
    }
    Access::Other
}

#[cfg(not(target_os = "macos"))]
fn permission_denied(path: &Path) -> String {
    format!(
        "Erti does not have permission to access {}. Check the folder's permissions and try again.",
        path.display()
    )
}

/// Which of the OS-protected folders, if any, this path sits inside.
///
/// Matching on path components rather than a string search, so a project named
/// `my-documents-backup` is not mistaken for `~/Documents`.
#[cfg(target_os = "macos")]
fn protected_folder(path: &Path) -> Option<&'static str> {
    let home = std::env::var_os("HOME")?;
    let relative = path.strip_prefix(Path::new(&home)).ok()?;

    let first = relative.components().next()?.as_os_str().to_str()?;

    match first {
        "Documents" => Some("Documents"),
        "Desktop" => Some("Desktop"),
        "Downloads" => Some("Downloads"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn denied() -> io::Error {
        io::Error::new(io::ErrorKind::PermissionDenied, "Operation not permitted")
    }

    #[test]
    fn a_refusal_is_actionable_rather_than_an_error_number() {
        // "Operation not permitted (os error 1)" was the whole message before.
        // What the user is told to do differs by platform; that they are told
        // something rather than given an errno does not.
        let message = describe(&denied(), Path::new("/somewhere/thesis"));

        assert!(!message.contains("os error"), "{message}");
        assert!(
            message.contains("permission") || message.contains("blocking"),
            "{message}"
        );
    }

    #[cfg(target_os = "macos")]
    mod macos {
        use super::*;
        use std::path::PathBuf;

        fn home() -> PathBuf {
            PathBuf::from(std::env::var("HOME").unwrap())
        }

        #[test]
        fn a_protected_folder_is_named_with_the_pane_that_governs_it() {
            let message = describe(&denied(), &home().join("Documents/papers"));

            assert!(message.contains("Documents folder"), "{message}");
            assert!(message.contains("Files and Folders"), "{message}");
        }

        #[test]
        fn an_unprotected_path_points_at_full_disk_access_instead() {
            let message = describe(&denied(), &home().join("dev/papers"));

            assert!(message.contains("Full Disk Access"), "{message}");
        }

        #[test]
        fn an_external_drive_points_at_its_own_permission() {
            // Removable Volumes is a separate TCC permission from Full Disk
            // Access, and the app declares a usage description for it. Sending
            // the user to Full Disk Access would ask for far more than Erti
            // needs and still not be the switch that unblocks them.
            let message = describe(&denied(), Path::new("/Volumes/Backup/papers/thesis.pdf"));

            assert!(message.contains("Removable Volumes"), "{message}");
            assert!(!message.contains("Full Disk Access"), "{message}");
        }

        #[test]
        fn a_similarly_named_folder_is_not_mistaken_for_a_protected_one() {
            // A substring search would call this Documents and send the user to
            // the wrong settings pane.
            assert_eq!(
                protected_folder(&home().join("Documents-backup/papers")),
                None
            );
            assert_eq!(protected_folder(&home().join("dev/Documents")), None);
            assert_eq!(
                protected_folder(&home().join("Documents/a/b")),
                Some("Documents")
            );
        }
    }

    #[test]
    fn the_wording_does_not_assume_the_caller_was_reading() {
        // The same formatter reports a failure to *create* the library
        // directory, so "could not read" would describe the wrong operation.
        let full = io::Error::new(io::ErrorKind::StorageFull, "No space left on device");

        let message = describe(&full, Path::new("/Users/someone/Erti"));

        assert!(!message.contains("read"), "{message}");
    }

    #[test]
    fn a_missing_folder_says_so_plainly() {
        let gone = io::Error::new(io::ErrorKind::NotFound, "No such file or directory");

        let message = describe(&gone, Path::new("/Users/someone/moved"));

        assert!(message.contains("no longer exists"), "{message}");
    }
}
