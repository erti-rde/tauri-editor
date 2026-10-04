//! The retrieval index, through the commands that use it (M2-1, ADR 005).
//!
//! `search_similar` and `search_annotations_semantically` keep their own tests
//! in `hybrid_data_model.rs`, `canonical_ids.rs` and `annotations.rs`, which
//! now run on the index unchanged (AC-4). These cover what's new: one index
//! holding every kind, built when first needed, and one query over it.

use erti_lib::db::index::HitKind;
use erti_lib::db::{queries, DbState};
use erti_lib::db_commands::{search_library_in, store_chunks_in};
use sqlx::SqlitePool;
use std::path::PathBuf;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("erti-index-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn chunk(text: &str, embedding: Vec<f32>) -> queries::NewChunk {
    queries::NewChunk {
        text: text.into(),
        embedding,
        page_start: Some(3),
        page_end: None,
        section: None,
        char_start: None,
        char_end: None,
    }
}

fn mark(id: &str, sha256: &str) -> queries::NewAnnotation {
    queries::NewAnnotation {
        id: id.into(),
        sha256: sha256.into(),
        kind: "highlight".into(),
        label_id: None,
        page: 4,
        rects: None,
        quote: Some("the effect was strongest".into()),
        prefix: None,
        suffix: None,
        char_start: None,
        char_end: None,
        note: None,
        style: None,
        page_label: None,
        origin: None,
    }
}

/// Source notes have no writer yet (M1b-8), so this one is put in by hand, as
/// that writer will: the note, and its vector in a table of its own.
async fn source_note(pool: &SqlitePool, id: &str, sha256: &str, embedding: &[f32]) {
    sqlx::query("INSERT INTO source_notes (id, sha256, body, page_label) VALUES (?, ?, ?, ?)")
        .bind(id)
        .bind(sha256)
        .bind("Read on paper: the method is the contribution.")
        .bind("xii")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO source_note_embeddings (id, embedding, text_hash) VALUES (?, ?, 'hash')",
    )
    .bind(id)
    .bind(erti_lib::db::pack_embedding(embedding))
    .execute(pool)
    .await
    .unwrap();
}

/// A library with one paper in the open project and one outside it, each with
/// a passage, a mark and a source note.
async fn library(name: &str) -> (PathBuf, DbState, SqlitePool) {
    let dir = scratch(name);
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await.unwrap();
    state.open_project(&dir.join("project")).await.unwrap();
    let pool = state.library().await.unwrap();

    for (sha256, near) in [("mine", 0.8f32), ("theirs", 1.0)] {
        queries::register_source(&pool, sha256, &format!("/{sha256}.pdf"), "f.pdf")
            .await
            .unwrap();
        // Passages and marks point the same way; source notes the other.
        store_chunks_in(&state, sha256, &[chunk(sha256, vec![near, 0.3])])
            .await
            .unwrap();
        let id = format!("{sha256}-mark");
        queries::save_annotation(&pool, &mark(&id, sha256))
            .await
            .unwrap();
        queries::save_annotation_embedding(&pool, &id, &[near, 0.4], "hash")
            .await
            .unwrap();
        source_note(&pool, &format!("{sha256}-note"), sha256, &[0.1, near]).await;
    }
    queries::add_to_project(&state.project().await.unwrap(), "mine")
        .await
        .unwrap();
    // What the app's own writers do; the rows above went in partly by hand.
    state.invalidate_index();

    (dir, state, pool)
}

fn kind_and_id(hit: &queries::Hit) -> (HitKind, String) {
    match hit {
        queries::Hit::Chunk(c) => (HitKind::Chunk, format!("{}#{}", c.sha256, c.idx)),
        queries::Hit::Annotation(a) => (HitKind::Annotation, a.annotation.id.clone()),
        queries::Hit::SourceNote(n) => (HitKind::SourceNote, n.note.id.clone()),
    }
}

// M2-1 AC-1, AC-3
#[tokio::test]
async fn one_query_finds_passages_marks_and_source_notes_each_saying_which() {
    let (_dir, state, _pool) = library("every-kind").await;

    let hits = search_library_in(&state, &[1.0, 0.3], None, None, Some(true))
        .await
        .unwrap();

    let found: Vec<(HitKind, String)> = hits.iter().map(kind_and_id).collect();
    assert_eq!(
        found,
        [
            // The project's first, closest first.
            (HitKind::Chunk, "mine#0".into()),
            (HitKind::Annotation, "mine-mark".into()),
            (HitKind::SourceNote, "mine-note".into()),
            (HitKind::Chunk, "theirs#0".into()),
            (HitKind::Annotation, "theirs-mark".into()),
            (HitKind::SourceNote, "theirs-note".into()),
        ]
    );

    // Each read back in full from the library, with its work and scope.
    let queries::Hit::SourceNote(note) = &hits[2] else {
        panic!("expected a source note")
    };
    assert_eq!(note.note.page_label.as_deref(), Some("xii"));
    assert_eq!(note.source_id, "mine");
    assert!(note.in_project);
    let queries::Hit::Annotation(mark) = &hits[4] else {
        panic!("expected a mark")
    };
    assert_eq!(
        mark.annotation.quote.as_deref(),
        Some("the effect was strongest")
    );
    assert!(!mark.in_project);
}

// M2-1 AC-1
#[tokio::test]
async fn the_kind_crosses_ipc_as_a_tag_beside_the_result() {
    let (_dir, state, _pool) = library("serialised").await;

    let hits = search_library_in(
        &state,
        &[1.0, 0.3],
        Some(vec![HitKind::Annotation]),
        Some(1),
        None,
    )
    .await
    .unwrap();

    let json = serde_json::to_value(&hits[0]).unwrap();
    assert_eq!(json["kind"], "annotation");
    // The mark keeps its own `kind`, which is why the result isn't flattened.
    assert_eq!(json["hit"]["kind"], "highlight");
    assert_eq!(json["hit"]["id"], "mine-mark");
}

// M2-1 AC-3
#[tokio::test]
async fn kinds_and_the_project_narrow_the_search_before_it_is_scored() {
    let (_dir, state, _pool) = library("filters").await;

    // Outside the project scores higher, and passages higher than notes: a
    // top-1 scored first and filtered after would find nothing.
    let notes_here = search_library_in(
        &state,
        &[1.0, 0.3],
        Some(vec![HitKind::SourceNote]),
        Some(1),
        Some(false),
    )
    .await
    .unwrap();
    assert_eq!(
        notes_here.iter().map(kind_and_id).collect::<Vec<_>>(),
        [(HitKind::SourceNote, "mine-note".into())]
    );

    let marks_anywhere = search_library_in(
        &state,
        &[1.0, 0.3],
        Some(vec![HitKind::Annotation, HitKind::SourceNote]),
        Some(10),
        Some(true),
    )
    .await
    .unwrap();
    assert!(marks_anywhere
        .iter()
        .all(|hit| !matches!(hit, queries::Hit::Chunk(_))));
    assert_eq!(marks_anywhere.len(), 4);
}

// M2-1 AC-2
#[tokio::test]
async fn the_index_is_built_on_the_first_search_not_on_opening() {
    let (_dir, state, _pool) = library("lazy").await;
    assert!(
        !state.index_is_built(),
        "opening the library builds nothing"
    );

    search_library_in(&state, &[1.0, 0.0], None, None, None)
        .await
        .unwrap();
    assert!(state.index_is_built());

    // Kept between searches.
    let first = state.index().await.unwrap();
    let second = state.index().await.unwrap();
    assert!(std::sync::Arc::ptr_eq(&first, &second));
}

// M2-1 AC-2
#[tokio::test]
async fn a_change_of_model_rebuilds_the_index() {
    let (_dir, state, pool) = library("model-change").await;
    queries::set_embedding_meta(&pool, "model-a", 2)
        .await
        .unwrap();
    let before = state.index().await.unwrap();
    assert_eq!(before.model(), Some("model-a"));

    // Written straight to the library, as a migration might, not through the
    // command that also drops the index: the index notices on its own.
    queries::set_embedding_meta(&pool, "model-b", 2)
        .await
        .unwrap();

    let after = state.index().await.unwrap();
    assert!(!std::sync::Arc::ptr_eq(&before, &after));
    assert_eq!(after.model(), Some("model-b"));
}

#[tokio::test]
async fn storing_a_paper_s_passages_is_seen_by_the_next_search() {
    // The index is dropped by the write and built again from the library. M2-2
    // covers every writer; this is the path every search depends on first.
    let (_dir, state, pool) = library("after-ingest").await;
    search_library_in(&state, &[0.0, 1.0], None, None, None)
        .await
        .unwrap();

    queries::register_source(&pool, "new", "/new.pdf", "new.pdf")
        .await
        .unwrap();
    queries::add_to_project(&state.project().await.unwrap(), "new")
        .await
        .unwrap();
    store_chunks_in(&state, "new", &[chunk("new", vec![0.0, 1.0])])
        .await
        .unwrap();
    assert!(!state.index_is_built());

    let hits = search_library_in(
        &state,
        &[0.0, 1.0],
        Some(vec![HitKind::Chunk]),
        Some(1),
        None,
    )
    .await
    .unwrap();
    assert_eq!(kind_and_id(&hits[0]), (HitKind::Chunk, "new#0".into()));
}

#[tokio::test]
async fn opening_another_library_drops_the_index_of_the_last() {
    let (dir, state, _pool) = library("reopen").await;
    state.index().await.unwrap();

    state.open_library(&dir.join("other.db")).await.unwrap();

    assert!(!state.index_is_built());
    let hits = search_library_in(&state, &[1.0, 0.3], None, None, Some(true))
        .await
        .unwrap();
    assert!(hits.is_empty(), "nothing from the last library");
}
