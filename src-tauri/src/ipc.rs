//! The typed contract between Rust and the webview (ADR 011).
//!
//! Every command returns `Result<T, AppError>`. Before this, errors crossed as
//! bare strings, so the interface could only tell "permission denied" from "not
//! found" from "database locked" by matching text. Now it branches on `kind`,
//! and `message` is the human sentence to show.
//!
//! The TypeScript side is generated from the commands registered in
//! `crate::ipc_builder` into `src/lib/ipc/bindings.ts`.

use serde::Serialize;
use std::fmt;
use std::io;
use std::path::Path;

/// What sort of failure this was, for the interface to act on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
pub enum ErrorKind {
    /// A file, source or record that isn't there (any more).
    NotFound,
    /// The operating system refused; the message says which setting fixes it.
    PermissionDenied,
    /// The request itself was malformed or out of range.
    InvalidInput,
    /// It clashes with the current state: already exists, not open yet.
    Conflict,
    /// Some other filesystem failure.
    Io,
    /// The library or project database failed.
    Database,
    /// The embedding model failed.
    Model,
    /// A network request failed.
    Network,
    /// A bug: something that should not happen.
    Internal,
}

/// An error on its way to the webview.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct AppError {
    pub kind: ErrorKind,
    /// A sentence a person can read, already saying what to do where possible.
    pub message: String,
}

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn database(message: impl fmt::Display) -> Self {
        Self::new(ErrorKind::Database, message.to_string())
    }

    pub fn model(message: impl fmt::Display) -> Self {
        Self::new(ErrorKind::Model, message.to_string())
    }

    pub fn io(message: impl fmt::Display) -> Self {
        Self::new(ErrorKind::Io, message.to_string())
    }

    pub fn internal(message: impl fmt::Display) -> Self {
        Self::new(ErrorKind::Internal, message.to_string())
    }

    /// A filesystem failure on `path`, classified by what the OS said and
    /// described by `fs_errors` in terms of what the user can do about it.
    pub fn from_io(err: &io::Error, path: &Path) -> Self {
        let kind = match err.kind() {
            io::ErrorKind::NotFound => ErrorKind::NotFound,
            io::ErrorKind::PermissionDenied => ErrorKind::PermissionDenied,
            _ => ErrorKind::Io,
        };
        Self::new(kind, crate::fs_errors::describe(err, path))
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for AppError {}

/// Classify a string error at the command boundary.
///
/// The query layer still reports failures as strings; the command knows which
/// layer it called, so it names the kind there.
pub trait Classify<T> {
    fn or_database(self) -> Result<T, AppError>;
    fn or_model(self) -> Result<T, AppError>;
    fn or_internal(self) -> Result<T, AppError>;
}

/// Errors that arrive without a kind: the query layer's strings, and a
/// background task that panicked. `AppError` is deliberately not one of them:
/// classifying an error that already has a kind would overwrite it, which is
/// how a missing file once reached the interface as a database error.
pub trait Unclassified: fmt::Display {}
impl Unclassified for String {}
impl Unclassified for tokio::task::JoinError {}

impl<T, E: Unclassified> Classify<T> for Result<T, E> {
    fn or_database(self) -> Result<T, AppError> {
        self.map_err(AppError::database)
    }
    fn or_model(self) -> Result<T, AppError> {
        self.map_err(AppError::model)
    }
    fn or_internal(self) -> Result<T, AppError> {
        self.map_err(AppError::internal)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_file_is_not_found_and_says_so() {
        let err = io::Error::new(io::ErrorKind::NotFound, "gone");
        let app = AppError::from_io(&err, Path::new("/papers/a.pdf"));
        assert_eq!(app.kind, ErrorKind::NotFound);
        assert!(app.message.contains("/papers/a.pdf"));
    }

    #[test]
    fn a_refusal_is_permission_denied() {
        let err = io::Error::new(io::ErrorKind::PermissionDenied, "no");
        assert_eq!(
            AppError::from_io(&err, Path::new("/x")).kind,
            ErrorKind::PermissionDenied
        );
    }

    #[test]
    fn any_other_filesystem_failure_is_io() {
        let err = io::Error::new(io::ErrorKind::Interrupted, "hm");
        assert_eq!(AppError::from_io(&err, Path::new("/x")).kind, ErrorKind::Io);
    }

    #[test]
    fn the_command_boundary_names_the_layer_it_called() {
        let db: Result<(), String> = Err("database is locked".into());
        assert_eq!(db.or_database().unwrap_err().kind, ErrorKind::Database);
        let model: Result<(), String> = Err("ML state not initialized".into());
        assert_eq!(model.or_model().unwrap_err().kind, ErrorKind::Model);
    }

    #[test]
    fn it_crosses_ipc_as_kind_and_message() {
        let json = serde_json::to_string(&AppError::new(ErrorKind::NotFound, "gone")).unwrap();
        assert_eq!(json, r#"{"kind":"NotFound","message":"gone"}"#);
    }
}
