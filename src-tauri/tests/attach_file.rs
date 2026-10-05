//! Attaching a PDF to a source (M1b-7, ADR 003, docs/ux.md UX-2 and UX-3):
//! the file keeps its own row under its hash, and an alias makes it the work's.

use erti_lib::db::{queries, DbState};
use erti_lib::db_commands::{
    add_source_by_hand_in, attach_file_in, source_files_in, store_chunks_in,
};
use erti_lib::ipc::ErrorKind;
use std::path::PathBuf;

const BOOK: &str = "erti:6f1c3a52-8d0e-4c1b-9a7e-2b5d4f3e1a01";
const OTHER: &str = "erti:0b7e4d2a-1c3f-4e5a-8b6d-9f0a1b2c3d4e";

struct World {
    state: DbState,
    project: PathBuf,
}

async fn world(name: &str) -> World {
    let dir = std::env::temp_dir().join(format!("erti-attach-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("project")).unwrap();
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await.unwrap();
    state.open_project(&dir.join("project")).await.unwrap();
    for (id, title) in [
        (BOOK, "Orality and Literacy"),
        (OTHER, "The Gutenberg Galaxy"),
    ] {
        add_source_by_hand_in(
            &state,
            id.into(),
            format!(r#"{{"type":"book","title":"{title}"}}"#),
            "book".into(),
        )
        .await
        .unwrap();
    }
    World {
        state,
        project: std::fs::canonicalize(dir.join("project")).unwrap(),
    }
}

impl World {
    /// A PDF in the project folder; its contents decide its hash.
    fn pdf(&self, name: &str, contents: &str) -> String {
        let path = self.project.join(name);
        std::fs::write(&path, contents).unwrap();
        path.to_string_lossy().to_string()
    }

    async fn listed(&self) -> Vec<queries::Source> {
        queries::project_sources(
            &self.state.library().await.unwrap(),
            &self.state.project().await.unwrap(),
        )
        .await
        .unwrap()
    }

    /// The project's sources' ids, sorted.
    async fn ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.listed().await.into_iter().map(|s| s.sha256).collect();
        ids.sort();
        ids
    }

    async fn row(&self, id: &str) -> queries::Source {
        self.listed()
            .await
            .into_iter()
            .find(|s| s.sha256 == id)
            .unwrap()
    }
}

fn chunk() -> queries::NewChunk {
    queries::NewChunk {
        text: "Writing restructures consciousness.".into(),
        embedding: vec![1.0, 0.0],
        page_start: Some(1),
        page_end: Some(1),
        section: None,
        char_start: None,
        char_end: None,
    }
}

// M1b-7 AC-1
#[tokio::test]
async fn attaching_makes_the_file_the_works_and_its_row_follows_the_reading() {
    let w = world("attach").await;
    let path = w.pdf("ong.pdf", "%PDF ong");

    let attached = attach_file_in(&w.state, BOOK, path.clone()).await.unwrap();
    assert!(attached.needs_ingest, "a file new to the library is read");
    assert_eq!(attached.file_name, "ong.pdf");
    assert_eq!(attached.merged, None);

    let aliases = queries::alias_map(&w.state.library().await.unwrap())
        .await
        .unwrap();
    assert_eq!(
        aliases.get(&attached.sha256).map(String::as_str),
        Some(BOOK)
    );

    // One row, still the book, still citable, with the file pending.
    assert_eq!(
        w.ids().await,
        [OTHER, BOOK],
        "the file is the book, not a source of its own"
    );
    let row = &w.row(BOOK).await;
    assert_eq!(row.sha256, BOOK);
    assert_eq!(row.state, "ready", "citing it doesn't wait for the PDF");
    assert_eq!(row.path.as_deref(), Some(path.as_str()));
    assert_eq!(row.file_sha256.as_deref(), Some(attached.sha256.as_str()));
    assert_eq!(row.file_state.as_deref(), Some("pending"));

    // Ingest goes under the file's hash, and the row follows it to ready.
    store_chunks_in(&w.state, &attached.sha256, &[chunk()])
        .await
        .unwrap();
    assert_eq!(w.row(BOOK).await.file_state.as_deref(), Some("ready"));
}

// M1b-7 AC-1
#[tokio::test]
async fn a_failed_read_shows_on_the_works_row() {
    let w = world("failed").await;
    let attached = attach_file_in(&w.state, BOOK, w.pdf("ong.pdf", "%PDF ong"))
        .await
        .unwrap();
    queries::mark_ingest_failed(
        &w.state.library().await.unwrap(),
        &attached.sha256,
        "No text",
    )
    .await
    .unwrap();

    let row = w.row(BOOK).await;
    assert_eq!(row.state, "ready");
    assert_eq!(row.file_state.as_deref(), Some("failed"));
    assert_eq!(row.file_error.as_deref(), Some("No text"));
}

// M1b-7 AC-1
#[tokio::test]
async fn a_no_file_work_has_no_file_state() {
    let w = world("nofile").await;
    let row = w.row(BOOK).await;
    assert_eq!(row.file_state, None);
    assert_eq!(row.path, None);
}

// M1b-7 AC-1
#[tokio::test]
async fn a_file_the_library_has_read_already_is_not_read_again() {
    let w = world("known").await;
    let path = w.pdf("ong.pdf", "%PDF ong");
    let sha = erti_lib::db::hash_file(std::path::Path::new(&path))
        .await
        .unwrap();
    let library = w.state.library().await.unwrap();
    queries::register_source(&library, &sha, &path, "ong.pdf")
        .await
        .unwrap();
    store_chunks_in(&w.state, &sha, &[chunk()]).await.unwrap();

    let attached = attach_file_in(&w.state, BOOK, path).await.unwrap();
    assert!(!attached.needs_ingest);
    assert_eq!(attached.merged, None, "it had no details of its own");
}

// M1b-7 AC-1
#[tokio::test]
async fn a_file_that_was_a_source_of_its_own_says_it_was_merged() {
    let w = world("merged").await;
    let path = w.pdf("ong.pdf", "%PDF ong");
    let sha = erti_lib::db::hash_file(std::path::Path::new(&path))
        .await
        .unwrap();
    let library = w.state.library().await.unwrap();
    queries::register_source(&library, &sha, &path, "ong.pdf")
        .await
        .unwrap();
    sqlx::query("UPDATE sources SET csl_json = ? WHERE sha256 = ?")
        .bind(r#"{"type":"book","title":"Orality & Literacy (scan)"}"#)
        .bind(&sha)
        .execute(&library)
        .await
        .unwrap();

    let attached = attach_file_in(&w.state, BOOK, path).await.unwrap();
    assert_eq!(
        attached.merged.as_deref(),
        Some("Orality & Literacy (scan)")
    );
}

// M1b-7 AC-2
#[tokio::test]
async fn a_second_file_can_be_attached() {
    let w = world("second").await;
    let preprint = attach_file_in(&w.state, BOOK, w.pdf("preprint.pdf", "%PDF pre"))
        .await
        .unwrap();
    let published = attach_file_in(&w.state, BOOK, w.pdf("published.pdf", "%PDF pub"))
        .await
        .unwrap();

    let files = source_files_in(&w.state, BOOK).await.unwrap();
    let names: Vec<&str> = files.iter().map(|f| f.file_name.as_str()).collect();
    assert_eq!(
        names,
        ["preprint.pdf", "published.pdf"],
        "by name, not by hash"
    );
    assert!(files.iter().all(|f| f.found));

    // Either file's hash names the same work.
    for sha in [&preprint.sha256, &published.sha256] {
        assert_eq!(source_files_in(&w.state, sha).await.unwrap(), files);
    }
    assert_eq!(w.ids().await, [OTHER, BOOK]);
}

// M1b-7 AC-1
#[tokio::test]
async fn attaching_the_same_file_twice_is_refused() {
    let w = world("twice").await;
    let path = w.pdf("ong.pdf", "%PDF ong");
    attach_file_in(&w.state, BOOK, path.clone()).await.unwrap();

    let err = attach_file_in(&w.state, BOOK, path).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::Conflict);
    assert_eq!(err.message, "That PDF is already attached to this source.");
}

// M1b-7 AC-1
#[tokio::test]
async fn a_file_another_source_has_is_not_moved_to_this_one() {
    let w = world("elsewhere").await;
    let path = w.pdf("ong.pdf", "%PDF ong");
    let attached = attach_file_in(&w.state, BOOK, path.clone()).await.unwrap();

    let err = attach_file_in(&w.state, OTHER, path).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::Conflict);
    assert_eq!(
        err.message,
        "That PDF is already attached to \u{201c}Orality and Literacy\u{201d}."
    );
    let aliases = queries::alias_map(&w.state.library().await.unwrap())
        .await
        .unwrap();
    assert_eq!(
        aliases.get(&attached.sha256).map(String::as_str),
        Some(BOOK)
    );
}

// M1b-7 AC-1
#[tokio::test]
async fn a_refused_attach_leaves_nothing_behind() {
    let w = world("nothing").await;
    let path = w.pdf("ong.pdf", "%PDF ong");
    let sha = erti_lib::db::hash_file(std::path::Path::new(&path))
        .await
        .unwrap();

    let err = attach_file_in(&w.state, "erti:gone", path)
        .await
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::NotFound);

    let known: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sources WHERE sha256 = ?)")
        .bind(&sha)
        .fetch_one(&w.state.library().await.unwrap())
        .await
        .unwrap();
    assert!(!known, "the file isn't left in the library, in no project");
}

// M1a-3: the path is scoped like every other.
#[tokio::test]
async fn a_path_outside_the_project_and_unpicked_is_refused() {
    let w = world("scope").await;
    let outside =
        std::env::temp_dir().join(format!("erti-attach-outside-{}.pdf", std::process::id()));
    std::fs::write(&outside, "%PDF outside").unwrap();

    let err = attach_file_in(&w.state, BOOK, outside.to_string_lossy().to_string())
        .await
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::PermissionDenied);
    let _ = std::fs::remove_file(outside);
}

// M1b-7 AC-3
#[tokio::test]
async fn a_moved_file_is_reported_not_found_where_it_was_last_seen() {
    let w = world("moved").await;
    let path = w.pdf("ong.pdf", "%PDF ong");
    attach_file_in(&w.state, BOOK, path.clone()).await.unwrap();
    std::fs::remove_file(&path).unwrap();

    let files = source_files_in(&w.state, BOOK).await.unwrap();
    assert_eq!(files.len(), 1);
    assert!(!files[0].found);
    assert_eq!(files[0].path, path, "where it was last seen");
    assert_eq!(files[0].state, "pending");
}

// M1b-7 AC-3
#[tokio::test]
async fn a_file_is_shown_where_it_can_still_be_found() {
    let w = world("found").await;
    let first = w.pdf("ong.pdf", "%PDF ong");
    let attached = attach_file_in(&w.state, BOOK, first.clone()).await.unwrap();

    // Seen again later somewhere it no longer is: the older place still has it.
    sqlx::query(
        "INSERT INTO locations (sha256, path, file_name, last_seen)
         VALUES (?, ?, 'gone.pdf', datetime('now', '+1 day'))",
    )
    .bind(&attached.sha256)
    .bind(w.project.join("gone.pdf").to_string_lossy().to_string())
    .execute(&w.state.library().await.unwrap())
    .await
    .unwrap();

    let files = source_files_in(&w.state, BOOK).await.unwrap();
    assert!(files[0].found);
    assert_eq!(files[0].path, first);
    assert_eq!(files[0].file_name, "ong.pdf");
}

// M1b-7 AC-3
#[tokio::test]
async fn a_work_with_no_file_has_none_to_show() {
    let w = world("none").await;
    assert!(source_files_in(&w.state, BOOK).await.unwrap().is_empty());
}
