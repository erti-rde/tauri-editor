//! Reading marks, against a real SQLite database.
//!
//! Kept apart from `hybrid_data_model.rs`, which is about the library/project
//! split, and from `schema_migrations.rs`, which is about the upgrade path.
//!
//! The behaviours worth pinning down here are the ones where a researcher could
//! lose work they meant to keep: an edit that quietly becomes a new record, a
//! deleted colour taking the judgements filed under it, and an import that
//! cannot be undone.

use erti_lib::db::{queries, DbState};
use sqlx::SqlitePool;
use std::path::PathBuf;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("erti-annot-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A library with one registered source to hang annotations off.
async fn library_with_source(name: &str) -> (PathBuf, DbState, SqlitePool) {
    let dir = scratch(name);
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await.unwrap();
    let pool = state.library().await.unwrap();

    queries::register_source(&pool, "sha-1", "/papers/one.pdf", "one.pdf")
        .await
        .unwrap();

    (dir, state, pool)
}

fn highlight(id: &str) -> queries::NewAnnotation {
    queries::NewAnnotation {
        id: id.to_string(),
        sha256: "sha-1".to_string(),
        kind: "highlight".to_string(),
        label_id: Some("claim".to_string()),
        page: 4,
        rects: Some(r#"[{"x":72,"y":613,"w":431,"h":12}]"#.to_string()),
        quote: Some("the effect was strongest".to_string()),
        prefix: Some("We found that ".to_string()),
        suffix: Some(" in the treated group".to_string()),
        char_start: Some(1200),
        char_end: Some(1224),
        note: None,
        style: None,
        page_label: None,
        origin: None,
    }
}

#[tokio::test]
async fn an_annotation_survives_a_round_trip() {
    let (_dir, _state, pool) = library_with_source("roundtrip").await;

    queries::save_annotation(&pool, &highlight("a1"))
        .await
        .unwrap();

    let found = queries::annotations_for_source(&pool, "sha-1")
        .await
        .unwrap();

    assert_eq!(found.len(), 1);
    assert_eq!(found[0].quote.as_deref(), Some("the effect was strongest"));
    assert_eq!(found[0].page, 4);
    // Both anchors are kept, because they fail in different ways.
    assert!(found[0].rects.as_deref().unwrap().contains("431"));
    assert_eq!(found[0].prefix.as_deref(), Some("We found that "));
    // Written by Erti unless it says otherwise.
    assert_eq!(found[0].origin, "erti");
}

#[tokio::test]
async fn editing_a_note_keeps_the_same_record() {
    // Writing an edit as a delete and an insert would lose created_at, and with
    // it any sense of which note came first.
    let (_dir, _state, pool) = library_with_source("edit").await;

    queries::save_annotation(&pool, &highlight("a1"))
        .await
        .unwrap();
    let before = queries::annotations_for_source(&pool, "sha-1")
        .await
        .unwrap();

    let mut edited = highlight("a1");
    edited.note = Some("this contradicts Smith".to_string());
    queries::save_annotation(&pool, &edited).await.unwrap();

    let after = queries::annotations_for_source(&pool, "sha-1")
        .await
        .unwrap();

    assert_eq!(after.len(), 1, "an edit must not make a second annotation");
    assert_eq!(after[0].note.as_deref(), Some("this contradicts Smith"));
    assert_eq!(after[0].created_at, before[0].created_at);
}

#[tokio::test]
async fn annotations_go_when_their_paper_goes() {
    let (_dir, _state, pool) = library_with_source("cascade").await;

    queries::save_annotation(&pool, &highlight("a1"))
        .await
        .unwrap();

    sqlx::query("DELETE FROM sources WHERE sha256 = ?")
        .bind("sha-1")
        .execute(&pool)
        .await
        .unwrap();

    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM annotations")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(
        left, 0,
        "the foreign key has to be enforced, not merely declared"
    );
}

#[tokio::test]
async fn an_images_and_embeddings_go_with_their_annotation() {
    let (_dir, _state, pool) = library_with_source("children").await;

    queries::save_annotation(&pool, &highlight("a1"))
        .await
        .unwrap();

    sqlx::query("INSERT INTO annotation_images (id, png) VALUES (?, ?)")
        .bind("a1")
        .bind(vec![0u8, 1, 2])
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO annotation_embeddings (id, embedding, text_hash) VALUES (?, ?, ?)")
        .bind("a1")
        .bind(vec![0u8; 8])
        .bind("hash")
        .execute(&pool)
        .await
        .unwrap();

    queries::delete_annotation(&pool, "a1").await.unwrap();

    let images: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM annotation_images")
        .fetch_one(&pool)
        .await
        .unwrap();
    let embeddings: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM annotation_embeddings")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!((images, embeddings), (0, 0));
}

#[tokio::test]
async fn an_import_can_be_undone_without_touching_your_own_marks() {
    // Importing is offered rather than done silently, and this is the other half
    // of that bargain.
    let (_dir, _state, pool) = library_with_source("imported").await;

    queries::save_annotation(&pool, &highlight("mine"))
        .await
        .unwrap();

    let mut theirs = highlight("theirs");
    theirs.origin = Some("imported".to_string());
    queries::save_annotation(&pool, &theirs).await.unwrap();

    let removed = queries::delete_imported_annotations(&pool, "sha-1")
        .await
        .unwrap();

    let left = queries::annotations_for_source(&pool, "sha-1")
        .await
        .unwrap();

    assert_eq!(removed, 1);
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].id, "mine");
}

#[tokio::test]
async fn a_kind_outside_the_three_is_refused() {
    let (_dir, _state, pool) = library_with_source("kind").await;

    let mut wrong = highlight("a1");
    wrong.kind = "scribble".to_string();

    assert!(queries::save_annotation(&pool, &wrong).await.is_err());
}

#[tokio::test]
async fn the_eight_labels_are_there_on_a_new_library() {
    let (_dir, _state, pool) = library_with_source("labels").await;

    let labels = queries::annotation_labels(&pool).await.unwrap();

    assert_eq!(labels.len(), 8);
    assert_eq!(labels[0].name, "Claim");
    assert_eq!(labels.last().unwrap().name, "My opinion");
    // Ordered as they are shown, not by id.
    assert!(labels.windows(2).all(|p| p[0].position < p[1].position));
}

#[tokio::test]
async fn a_label_deleted_on_purpose_stays_deleted() {
    // Seeding runs on every open. A check for an empty table would restore all
    // eight for someone who had deliberately cleared them.
    let dir = scratch("stays-deleted");
    let path = dir.join("library.db");

    let first = DbState::default();
    first.open_library(&path).await.unwrap();
    queries::delete_label(&first.library().await.unwrap(), "definition")
        .await
        .unwrap();

    let second = DbState::default();
    second.open_library(&path).await.unwrap();
    let labels = queries::annotation_labels(&second.library().await.unwrap())
        .await
        .unwrap();

    assert_eq!(labels.len(), 7);
    assert!(!labels.iter().any(|l| l.id == "definition"));
}

#[tokio::test]
async fn deleting_a_colour_does_not_delete_the_judgements_filed_under_it() {
    // The mark was a real decision about the passage. Losing the colour is not
    // a reason to lose the mark.
    let (_dir, _state, pool) = library_with_source("label-delete").await;

    queries::save_annotation(&pool, &highlight("a1"))
        .await
        .unwrap();
    queries::delete_label(&pool, "claim").await.unwrap();

    let left = queries::annotations_for_source(&pool, "sha-1")
        .await
        .unwrap();

    assert_eq!(left.len(), 1);
    assert_eq!(left[0].label_id, None, "it becomes unlabelled, not gone");
}

#[tokio::test]
async fn a_renamed_label_keeps_its_id_so_its_highlights_follow() {
    let (_dir, _state, pool) = library_with_source("rename").await;

    let mut labels = queries::annotation_labels(&pool).await.unwrap();
    labels[0].name = "Thesis".to_string();
    labels[0].colour = "0 0% 50%".to_string();
    queries::save_label(&pool, &labels[0]).await.unwrap();

    let after = queries::annotation_labels(&pool).await.unwrap();

    assert_eq!(after[0].id, "claim");
    assert_eq!(after[0].name, "Thesis");
    assert_eq!(after[0].colour, "0 0% 50%");
    assert_eq!(after.len(), 8, "renaming must not add a label");
}

#[tokio::test]
async fn reading_stops_and_starts_again_in_the_same_place() {
    let (_dir, _state, pool) = library_with_source("position").await;

    assert_eq!(
        queries::reading_position(&pool, "sha-1").await.unwrap(),
        None
    );

    queries::save_reading_position(&pool, "sha-1", 12, Some(0.5), Some("page-width"))
        .await
        .unwrap();
    queries::save_reading_position(&pool, "sha-1", 14, None, None)
        .await
        .unwrap();

    assert_eq!(
        queries::reading_position(&pool, "sha-1").await.unwrap(),
        Some(14),
        "the latest place, not a second row"
    );
}

#[tokio::test]
async fn a_source_can_be_found_from_its_file_and_back() {
    let (_dir, _state, pool) = library_with_source("paths").await;

    assert_eq!(
        queries::source_for_path(&pool, "/papers/one.pdf")
            .await
            .unwrap(),
        Some("sha-1".to_string())
    );
    assert_eq!(
        queries::path_for_source(&pool, "sha-1").await.unwrap(),
        Some("/papers/one.pdf".to_string())
    );

    // A paper Erti has never seen is an ordinary answer, not a failure.
    assert_eq!(
        queries::source_for_path(&pool, "/nowhere.pdf")
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        queries::path_for_source(&pool, "unknown").await.unwrap(),
        None
    );
}

#[tokio::test]
async fn marks_are_found_by_the_words_in_them() {
    let (_dir, _state, pool) = library_with_source("literal").await;

    let mut noted = highlight("a1");
    noted.note = Some("this contradicts Smith on sample size".to_string());
    queries::save_annotation(&pool, &noted).await.unwrap();
    queries::save_annotation(&pool, &highlight("a2"))
        .await
        .unwrap();

    // The reader's own words are searched as well as the paper's, which is the
    // point: what you wrote is usually a better handle on a note than what the
    // paper said.
    let by_note = queries::search_annotations_literally(&pool, "contradicts", &[], 10)
        .await
        .unwrap();
    assert_eq!(by_note.len(), 1);
    assert_eq!(by_note[0].annotation.id, "a1");

    let by_quote = queries::search_annotations_literally(&pool, "strongest", &[], 10)
        .await
        .unwrap();
    assert_eq!(by_quote.len(), 2);
}

#[tokio::test]
async fn a_search_says_which_paper_a_mark_is_on() {
    let (_dir, _state, pool) = library_with_source("names").await;

    queries::save_annotation(&pool, &highlight("a1"))
        .await
        .unwrap();

    let found = queries::search_annotations_literally(&pool, "effect", &[], 10)
        .await
        .unwrap();

    assert_eq!(found[0].file_name.as_deref(), Some("one.pdf"));
}

#[tokio::test]
async fn a_wildcard_typed_into_the_box_is_not_a_wildcard() {
    // '%' is an ordinary character in a quotation about statistics, and typing
    // it should not match every mark in the library.
    let (_dir, _state, pool) = library_with_source("escaping").await;

    let mut percent = highlight("a1");
    percent.quote = Some("rose by 40% in the treated group".to_string());
    queries::save_annotation(&pool, &percent).await.unwrap();
    queries::save_annotation(&pool, &highlight("a2"))
        .await
        .unwrap();

    let found = queries::search_annotations_literally(&pool, "40%", &[], 10)
        .await
        .unwrap();

    assert_eq!(found.len(), 1);
    assert_eq!(found[0].annotation.id, "a1");
}

#[tokio::test]
async fn a_semantic_search_ranks_the_project_first() {
    // The same grouping the chunk search uses, so the two surfaces behave alike.
    let dir = scratch("semantic");
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await.unwrap();
    let pool = state.library().await.unwrap();

    for (hash, name) in [("sha-1", "mine.pdf"), ("sha-2", "elsewhere.pdf")] {
        queries::register_source(&pool, hash, &format!("/papers/{name}"), name)
            .await
            .unwrap();
    }

    for (id, hash) in [("a1", "sha-1"), ("a2", "sha-2")] {
        let mut mark = highlight(id);
        mark.sha256 = hash.to_string();
        queries::save_annotation(&pool, &mark).await.unwrap();
        queries::save_annotation_embedding(&pool, id, &[0.5, 0.5, 0.5], "hash")
            .await
            .unwrap();
    }

    let found = queries::search_annotations_semantically(
        &pool,
        &[0.5, 0.5, 0.5],
        &["sha-2".to_string()],
        10,
    )
    .await
    .unwrap();

    assert_eq!(found.len(), 2);
    assert!(found[0].in_project, "the project's own paper comes first");
    assert_eq!(found[0].annotation.id, "a2");
}

#[tokio::test]
async fn a_mark_with_no_vector_is_not_a_semantic_result() {
    // An area snapshot has no words. It should not appear in a search by
    // meaning with a similarity of zero as if it had been considered.
    let (_dir, _state, pool) = library_with_source("unembedded").await;

    queries::save_annotation(&pool, &highlight("a1"))
        .await
        .unwrap();

    let found = queries::search_annotations_semantically(&pool, &[0.5, 0.5, 0.5], &[], 10)
        .await
        .unwrap();

    assert!(found.is_empty());
}

#[tokio::test]
async fn the_defaults_can_be_put_back_after_clearing_them() {
    // Deleting all eight otherwise leaves no way back short of editing the
    // database by hand — a trap, given every label is meant to be removable.
    let (_dir, _state, pool) = library_with_source("restore").await;

    for (id, _, _) in queries::DEFAULT_LABELS {
        queries::delete_label(&pool, id).await.unwrap();
    }
    assert!(queries::annotation_labels(&pool).await.unwrap().is_empty());

    let restored = queries::restore_default_labels(&pool).await.unwrap();

    assert_eq!(restored, 8);
    assert_eq!(queries::annotation_labels(&pool).await.unwrap().len(), 8);
}

#[tokio::test]
async fn restoring_leaves_a_renamed_label_alone() {
    // Someone who renamed Claim to Thesis and then deleted Definition wants
    // Definition back, not their own work overwritten.
    let (_dir, _state, pool) = library_with_source("restore-keeps").await;

    let mut labels = queries::annotation_labels(&pool).await.unwrap();
    labels[0].name = "Thesis".to_string();
    queries::save_label(&pool, &labels[0]).await.unwrap();
    queries::delete_label(&pool, "definition").await.unwrap();

    let restored = queries::restore_default_labels(&pool).await.unwrap();

    let after = queries::annotation_labels(&pool).await.unwrap();
    assert_eq!(restored, 1, "only the missing one");
    assert_eq!(after.len(), 8);
    assert_eq!(
        after.iter().find(|l| l.id == "claim").unwrap().name,
        "Thesis",
        "a renamed label is not reverted"
    );
}

#[test]
fn a_colour_is_named_the_way_a_reader_would_name_it() {
    // For the researcher who does not want Erti's opinion about what their
    // highlights mean. The eight defaults have to come out as eight distinct
    // names, or the option is worse than not having it.
    let named: Vec<&str> = queries::DEFAULT_LABELS
        .iter()
        .map(|(_, _, colour)| queries::colour_name(colour))
        .collect();

    assert_eq!(
        named,
        vec!["Yellow", "Green", "Blue", "Red", "Teal", "Purple", "Magenta", "Gray"]
    );
}

#[test]
fn a_washed_out_colour_is_grey_whatever_its_hue_says() {
    // Hue is meaningless below a certain saturation; 210 degrees of nothing is
    // not blue.
    assert_eq!(queries::colour_name("210 4% 60%"), "Gray");
    assert_eq!(queries::colour_name("0 0% 50%"), "Gray");
}

#[test]
fn red_is_red_at_both_ends_of_the_circle() {
    assert_eq!(queries::colour_name("5 80% 66%"), "Red");
    assert_eq!(queries::colour_name("355 80% 66%"), "Red");
}

#[test]
fn a_malformed_colour_still_gets_a_name() {
    // A label whose colour was edited by hand should not break the rename.
    assert_eq!(queries::colour_name(""), "Gray");
    assert_eq!(queries::colour_name("not a colour"), "Gray");
}

#[tokio::test]
async fn labels_can_be_renamed_after_their_colours() {
    let (_dir, _state, pool) = library_with_source("colour-names").await;

    let renamed = queries::name_labels_after_colours(&pool).await.unwrap();
    let after = queries::annotation_labels(&pool).await.unwrap();

    assert_eq!(renamed, 8);
    assert_eq!(after[0].name, "Yellow");
    assert_eq!(
        after[0].id, "claim",
        "the id is kept, so its highlights follow"
    );
}

#[tokio::test]
async fn renaming_after_colours_twice_changes_nothing_the_second_time() {
    // So the button can say honestly whether it did anything.
    let (_dir, _state, pool) = library_with_source("colour-names-twice").await;

    queries::name_labels_after_colours(&pool).await.unwrap();

    assert_eq!(queries::name_labels_after_colours(&pool).await.unwrap(), 0);
}

#[tokio::test]
async fn a_mark_is_a_fill_unless_it_says_otherwise() {
    // Underlines arrived in schema 4; every mark made before that was a fill.
    let (_dir, _state, pool) = library_with_source("style-default").await;

    queries::save_annotation(&pool, &highlight("a1"))
        .await
        .unwrap();

    let style: String = sqlx::query_scalar("SELECT style FROM annotations WHERE id = 'a1'")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(style, "fill");
}
