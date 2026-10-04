//! Removing a source from the library (M1b-4, docs/ux.md UX-4).
//!
//! The case that matters is a work with a PDF attached (ADR 003): the dialog
//! counts the marks on the PDF as the work's, so removing the work has to take
//! the PDF's records too, or it would reappear as a work of its own with the
//! highlights the researcher was told were gone.

use erti_lib::db::{queries, DbState};
use erti_lib::db_commands::{remove_source_in, search_library_in};
use sqlx::SqlitePool;
use std::path::PathBuf;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("erti-remove-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn mark(id: &str, sha256: &str, kind: &str) -> queries::NewAnnotation {
    queries::NewAnnotation {
        id: id.into(),
        sha256: sha256.into(),
        kind: kind.into(),
        label_id: None,
        page: 2,
        rects: None,
        quote: Some("a quoted line".into()),
        prefix: None,
        suffix: None,
        char_start: None,
        char_end: None,
        note: Some("worth citing".into()),
        style: None,
        page_label: None,
        origin: None,
    }
}

fn chunk() -> queries::NewChunk {
    queries::NewChunk {
        text: "a passage".into(),
        embedding: vec![1.0, 0.0],
        page_start: Some(2),
        page_end: None,
        section: None,
        char_start: None,
        char_end: None,
    }
}

async fn count(library: &SqlitePool, table: &str) -> i64 {
    sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
        .fetch_one(library)
        .await
        .unwrap()
}

/// A book with a PDF attached, read and marked, beside another paper that
/// must come through untouched.
async fn library(name: &str) -> (PathBuf, DbState, SqlitePool, PathBuf) {
    let dir = scratch(name);
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await.unwrap();
    let library = state.library().await.unwrap();

    let pdf = dir.join("book.pdf");
    std::fs::write(&pdf, b"%PDF-1.7 the book").unwrap();

    queries::add_source_without_file(
        &library,
        "erti:book",
        r#"{"type":"book","title":"Book"}"#,
        None,
        None,
    )
    .await
    .unwrap();
    for (sha256, path) in [
        ("pdf", pdf.to_str().unwrap()),
        ("other", "/papers/other.pdf"),
    ] {
        queries::register_source(&library, sha256, path, "f.pdf")
            .await
            .unwrap();
        queries::store_chunks(&library, sha256, &[chunk()])
            .await
            .unwrap();
        queries::save_annotation(&library, &mark(&format!("{sha256}-h"), sha256, "highlight"))
            .await
            .unwrap();
        queries::save_annotation_embedding(&library, &format!("{sha256}-h"), &[1.0, 0.0], "h")
            .await
            .unwrap();
        queries::save_reading_position(&library, sha256, 3, None, None)
            .await
            .unwrap();
    }
    queries::save_annotation(&library, &mark("pdf-area", "pdf", "area"))
        .await
        .unwrap();
    queries::save_annotation(&library, &mark("pdf-page", "pdf", "page-note"))
        .await
        .unwrap();
    queries::alias_source(&library, "pdf", "erti:book")
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO source_notes (id, sha256, body) VALUES ('n1', 'erti:book', 'argues X')",
    )
    .execute(&library)
    .await
    .unwrap();

    (dir, state, library, pdf)
}

// M1b-4 AC-1
#[tokio::test]
async fn the_dialog_counts_the_notes_and_highlights_on_the_work_and_its_files() {
    let (_dir, _state, library, pdf) = library("counts").await;

    let expected = queries::SourceRemoval {
        // The source note, and the page note on the PDF.
        notes: 2,
        // A highlight and an area snapshot on the PDF; none from `other`.
        highlights: 2,
        // The attached PDF's: the book has no file of its own.
        paths: vec![pdf.to_string_lossy().into_owned()],
    };
    assert_eq!(
        queries::source_removal(&library, "erti:book")
            .await
            .unwrap(),
        expected
    );
    // Asked by the PDF's hash, it's the same work.
    assert_eq!(
        queries::source_removal(&library, "pdf").await.unwrap(),
        expected
    );
}

// M1b-4 AC-2
#[tokio::test]
async fn removing_a_work_takes_its_files_records_marks_and_notes_and_leaves_the_pdf() {
    let (_dir, state, library, pdf) = library("cascade").await;

    remove_source_in(&state, "erti:book").await.unwrap();

    let sources: Vec<String> = sqlx::query_scalar("SELECT sha256 FROM sources")
        .fetch_all(&library)
        .await
        .unwrap();
    assert_eq!(sources, ["other"]);
    for (table, left) in [
        ("chunks", 1),
        ("locations", 1),
        ("ingest_status", 1),
        ("annotations", 1),
        ("annotation_embeddings", 1),
        ("reading_positions", 1),
        ("source_notes", 0),
        ("source_aliases", 0),
    ] {
        assert_eq!(
            count(&library, table).await,
            left,
            "{table}: only `other`'s"
        );
    }

    assert_eq!(
        std::fs::read(&pdf).unwrap(),
        b"%PDF-1.7 the book",
        "the file itself is never touched"
    );
}

// M1b-4 AC-2
#[tokio::test]
async fn removing_by_an_attached_file_s_hash_removes_the_whole_work() {
    let (_dir, state, library, _pdf) = library("by-alias").await;

    remove_source_in(&state, "pdf").await.unwrap();

    let sources: Vec<String> = sqlx::query_scalar("SELECT sha256 FROM sources")
        .fetch_all(&library)
        .await
        .unwrap();
    assert_eq!(sources, ["other"]);
}

#[tokio::test]
async fn a_removed_source_is_gone_from_the_next_search() {
    // The cascade took rows with vectors, so the index (M2-1) built before it
    // is dropped, and the next search is built from what's left.
    let (_dir, state, _library, _pdf) = library("index").await;
    let before = search_library_in(&state, &[1.0, 0.0], None, None, Some(true))
        .await
        .unwrap();
    assert_eq!(before.len(), 4, "a passage and a mark on each file");

    remove_source_in(&state, "erti:book").await.unwrap();

    assert!(!state.index_is_built());
    let after = search_library_in(&state, &[1.0, 0.0], None, None, Some(true))
        .await
        .unwrap();
    assert_eq!(after.len(), 2, "only `other`'s");
}

// M1b-4 AC-4: the toast points to a backup, so there has to be one holding
// what was removed, not only this morning's.
#[tokio::test]
async fn removing_a_source_backs_the_library_up_first() {
    let (dir, state, _library, _pdf) = library("backup").await;

    remove_source_in(&state, "erti:book").await.unwrap();

    let backups: Vec<PathBuf> = std::fs::read_dir(dir.join("backups"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    assert_eq!(backups.len(), 1, "{backups:?}");
    let copy = sqlx::SqlitePool::connect(&format!("sqlite:{}", backups[0].display()))
        .await
        .unwrap();
    let highlights: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM annotations WHERE sha256 = 'pdf'")
            .fetch_one(&copy)
            .await
            .unwrap();
    assert_eq!(highlights, 3, "the marks are in the copy");
}

#[tokio::test]
async fn a_source_already_gone_is_not_an_error() {
    // Two windows, or a double click: the second removal finds nothing to do.
    let (_dir, state, _library, _pdf) = library("twice").await;

    remove_source_in(&state, "erti:book").await.unwrap();
    remove_source_in(&state, "erti:book").await.unwrap();
}
