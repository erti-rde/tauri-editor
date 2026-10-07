//! Notes on a source (M1b-8, ADR 004, docs/ux.md UX-3): written on the work,
//! listed with the marks on each of its files.

use erti_lib::db::{queries, DbState};
use erti_lib::db_commands::{
    add_source_by_hand_in, delete_source_note_in, embed_source_note_with, save_source_note_in,
    search_notes_in, search_notes_literally_in, work_notes_in,
};
use erti_lib::ipc::ErrorKind;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

const BOOK: &str = "erti:6f1c3a52-8d0e-4c1b-9a7e-2b5d4f3e1a01";
const PDF: &str = "c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00";
const NOTE: &str = "4d9a8e1b-2c3f-4a5b-8c7d-6e5f4a3b2c1d";

async fn opened(name: &str) -> DbState {
    let dir = std::env::temp_dir().join(format!("erti-notes-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await.unwrap();
    state.open_project(&dir.join("project")).await.unwrap();
    add_source_by_hand_in(
        &state,
        BOOK.into(),
        r#"{"type":"book","title":"Orality and Literacy"}"#.into(),
        "book".into(),
    )
    .await
    .unwrap();
    state
}

fn note(id: &str, on: &str, body: &str) -> queries::NewSourceNote {
    queries::NewSourceNote {
        id: id.into(),
        sha256: on.into(),
        body: body.into(),
        quote: None,
        page_label: None,
        label_id: None,
    }
}

/// The book's PDF, attached: its own row, and an alias making it the book's.
async fn attach_pdf(state: &DbState) {
    let library = state.library().await.unwrap();
    queries::register_source(&library, PDF, "/papers/ong.pdf", "ong.pdf")
        .await
        .unwrap();
    queries::alias_source(&library, PDF, BOOK).await.unwrap();
}

async fn mark(state: &DbState, id: &str, page: i64) {
    let library = state.library().await.unwrap();
    let mark: queries::NewAnnotation = serde_json::from_value(serde_json::json!({
        "id": id, "sha256": PDF, "kind": "highlight", "page": page, "quote": "Writing restructures consciousness."
    }))
    .unwrap();
    queries::save_annotation(&library, &mark).await.unwrap();
}

// M1b-8 AC-2
#[tokio::test]
async fn a_note_is_kept_on_the_work_with_its_quote_page_and_label() {
    let state = opened("kept").await;

    save_source_note_in(
        &state,
        queries::NewSourceNote {
            quote: Some("  Oral structures look to pragmatics.  ".into()),
            page_label: Some(" 37 ".into()),
            label_id: Some("claim".into()),
            ..note(
                NOTE,
                BOOK,
                "The contrast I need for §3.\n\n*Additive*, not subordinative.",
            )
        },
    )
    .await
    .unwrap();

    let notes = work_notes_in(&state, BOOK.into()).await.unwrap().notes;
    assert_eq!(notes.len(), 1);
    let kept = &notes[0];
    assert_eq!(kept.id, NOTE);
    assert_eq!(kept.sha256, BOOK);
    assert_eq!(
        kept.body,
        "The contrast I need for §3.\n\n*Additive*, not subordinative."
    );
    assert_eq!(
        kept.quote.as_deref(),
        Some("Oral structures look to pragmatics.")
    );
    assert_eq!(kept.page_label.as_deref(), Some("37"));
    assert_eq!(kept.label_id.as_deref(), Some("claim"));
}

// M1b-8 AC-2
#[tokio::test]
async fn saving_again_rewrites_the_note_and_blank_fields_are_absent() {
    let state = opened("rewrite").await;
    save_source_note_in(
        &state,
        queries::NewSourceNote {
            page_label: Some("12".into()),
            ..note(NOTE, BOOK, "First thoughts")
        },
    )
    .await
    .unwrap();

    save_source_note_in(
        &state,
        queries::NewSourceNote {
            quote: Some("   ".into()),
            page_label: Some("".into()),
            ..note(NOTE, BOOK, "Second thoughts")
        },
    )
    .await
    .unwrap();

    let notes = work_notes_in(&state, BOOK.into()).await.unwrap().notes;
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].body, "Second thoughts");
    assert_eq!(notes[0].quote, None);
    assert_eq!(notes[0].page_label, None);
}

// M1b-8 AC-2
#[tokio::test]
async fn a_note_needs_words_and_a_work() {
    let state = opened("refused").await;

    let empty = save_source_note_in(&state, note(NOTE, BOOK, "  \n "))
        .await
        .unwrap_err();
    assert_eq!(empty.kind, ErrorKind::InvalidInput);

    let just_a_quote = queries::NewSourceNote {
        quote: Some("Writing restructures consciousness.".into()),
        ..note(NOTE, BOOK, "")
    };
    save_source_note_in(&state, just_a_quote).await.unwrap();

    let nowhere = save_source_note_in(&state, note("other", "erti:gone", "A thought"))
        .await
        .unwrap_err();
    assert_eq!(nowhere.kind, ErrorKind::NotFound);

    let long_page = queries::NewSourceNote {
        page_label: Some("9".repeat(101)),
        ..note("third", BOOK, "A thought")
    };
    let refused = save_source_note_in(&state, long_page).await.unwrap_err();
    assert_eq!(refused.kind, ErrorKind::InvalidInput);
}

// M1b-8 AC-1
#[tokio::test]
async fn the_work_lists_its_notes_then_the_marks_on_its_files_by_page() {
    let state = opened("listed").await;
    attach_pdf(&state).await;
    mark(&state, "late", 78).await;
    mark(&state, "early", 12).await;

    // Written through the PDF's id, kept on the book's.
    save_source_note_in(&state, note(NOTE, PDF, "On the book"))
        .await
        .unwrap();

    for id in [BOOK, PDF] {
        let listed = work_notes_in(&state, id.into()).await.unwrap();
        assert_eq!(listed.notes.len(), 1);
        assert_eq!(listed.notes[0].sha256, BOOK);
        let pages: Vec<i64> = listed.marks.iter().map(|m| m.page).collect();
        assert_eq!(pages, [12, 78]);
    }
}

// M1b-8 AC-1: sheet 3 of a scan and sheet 3 of a preprint aren't one page,
// so each file's marks are listed together, and the file named.
#[tokio::test]
async fn marks_on_two_files_are_listed_file_by_file() {
    let state = opened("two-files").await;
    attach_pdf(&state).await;
    let library = state.library().await.unwrap();
    let preprint = "abad1dea".repeat(8);
    queries::register_source(
        &library,
        &preprint,
        "/papers/a-preprint.pdf",
        "a-preprint.pdf",
    )
    .await
    .unwrap();
    queries::alias_source(&library, &preprint, BOOK)
        .await
        .unwrap();
    mark(&state, "scan-9", 9).await;
    let early: queries::NewAnnotation = serde_json::from_value(serde_json::json!({
        "id": "pre-3", "sha256": preprint, "kind": "highlight", "page": 3, "quote": "q"
    }))
    .unwrap();
    queries::save_annotation(&library, &early).await.unwrap();
    mark(&state, "scan-2", 2).await;

    let listed = work_notes_in(&state, BOOK.into()).await.unwrap();
    let names: Vec<&str> = listed.files.iter().map(|f| f.file_name.as_str()).collect();
    assert_eq!(
        names,
        ["a-preprint.pdf", "ong.pdf"],
        "attached files by name"
    );
    let marks: Vec<&str> = listed.marks.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(marks, ["pre-3", "scan-2", "scan-9"]);
}

// M1b-8 AC-2: Markdown's leading spaces are meaning.
#[tokio::test]
async fn a_note_keeps_its_leading_indentation() {
    let state = opened("indent").await;
    save_source_note_in(
        &state,
        note(NOTE, BOOK, "    for x in xs:\n        print(x)\n\n"),
    )
    .await
    .unwrap();

    let kept = work_notes_in(&state, BOOK.into()).await.unwrap();
    assert_eq!(kept.notes[0].body, "    for x in xs:\n        print(x)");
}

// M1b-8 AC-2
#[tokio::test]
async fn a_deleted_note_is_gone() {
    let state = opened("deleted").await;
    save_source_note_in(&state, note(NOTE, BOOK, "A thought"))
        .await
        .unwrap();

    delete_source_note_in(&state, NOTE.into()).await.unwrap();

    assert!(work_notes_in(&state, BOOK.into())
        .await
        .unwrap()
        .notes
        .is_empty());
}

/* --------------------------------------------- found by search (AC-4, AC-5) */

/// A stand-in for the model: one fixed vector, and a count of what it was
/// asked to embed.
fn model(asked: &Arc<AtomicUsize>) -> impl FnOnce(String) -> Result<Vec<f32>, String> + Send {
    let asked = Arc::clone(asked);
    move |_| {
        asked.fetch_add(1, Ordering::SeqCst);
        Ok(vec![1.0, 0.0])
    }
}

// M1b-8 AC-4
#[tokio::test]
async fn a_note_is_embedded_from_its_quote_and_body_and_not_again_while_they_stand() {
    let state = opened("embedded").await;
    let quoted = |label: &str, body: &str| queries::NewSourceNote {
        quote: Some("Oral structures look to pragmatics.".into()),
        label_id: Some(label.into()),
        ..note(NOTE, BOOK, body)
    };
    save_source_note_in(&state, quoted("claim", "Additive, not subordinative."))
        .await
        .unwrap();
    let library = state.library().await.unwrap();
    let to_embed = queries::source_note_to_embed(&library, NOTE)
        .await
        .unwrap()
        .expect("a new note wants a vector");
    assert_eq!(
        to_embed.text,
        "Oral structures look to pragmatics. \u{2014} Additive, not subordinative."
    );

    let asked = Arc::new(AtomicUsize::new(0));
    assert!(embed_source_note_with(&state, NOTE, model(&asked))
        .await
        .unwrap());
    assert_eq!(asked.load(Ordering::SeqCst), 1);

    // The same words, and a new label: nothing to embed.
    save_source_note_in(&state, quoted("method", "Additive, not subordinative."))
        .await
        .unwrap();
    assert!(!embed_source_note_with(&state, NOTE, model(&asked))
        .await
        .unwrap());
    assert_eq!(asked.load(Ordering::SeqCst), 1);

    // New words: embedded again.
    save_source_note_in(&state, quoted("method", "Additive, then aggregative."))
        .await
        .unwrap();
    assert!(embed_source_note_with(&state, NOTE, model(&asked))
        .await
        .unwrap());
    assert_eq!(asked.load(Ordering::SeqCst), 2);

    // A note that's gone has nothing to embed.
    delete_source_note_in(&state, NOTE.into()).await.unwrap();
    assert!(!embed_source_note_with(&state, NOTE, model(&asked))
        .await
        .unwrap());
}

// M1b-8 AC-4: the backfill behind "Prepare my notes".
#[tokio::test]
async fn notes_never_embedded_are_found_with_the_hash_of_their_words() {
    let state = opened("backfill").await;
    save_source_note_in(&state, note(NOTE, BOOK, "Never embedded"))
        .await
        .unwrap();
    save_source_note_in(&state, note("embedded", BOOK, "Already embedded"))
        .await
        .unwrap();
    let asked = Arc::new(AtomicUsize::new(0));
    embed_source_note_with(&state, "embedded", model(&asked))
        .await
        .unwrap();

    let library = state.library().await.unwrap();
    let pending = queries::source_notes_needing_embedding(&library, 10)
        .await
        .unwrap();
    assert_eq!(
        pending,
        vec![queries::NoteToEmbed {
            id: NOTE.to_string(),
            body: "Never embedded".to_string(),
            quote: None,
            text: "Never embedded".to_string(),
            hash: queries::text_hash("Never embedded"),
        }]
    );
}

// M1b-8 AC-4: a note edited while the model couldn't run keeps its old
// vector, and "Prepare my notes" must still see it as unprepared.
#[tokio::test]
async fn a_note_whose_words_changed_since_its_vector_is_embedded_again() {
    let state = opened("stale").await;
    save_source_note_in(&state, note(NOTE, BOOK, "First words"))
        .await
        .unwrap();
    let asked = Arc::new(AtomicUsize::new(0));
    embed_source_note_with(&state, NOTE, model(&asked))
        .await
        .unwrap();
    // Edited, and its embedding failed: the old vector stands.
    save_source_note_in(&state, note(NOTE, BOOK, "Second words"))
        .await
        .unwrap();
    assert!(
        embed_source_note_with(&state, NOTE, |_| Err("the model isn't ready".into()))
            .await
            .is_err()
    );

    let library = state.library().await.unwrap();
    let pending = queries::source_notes_needing_embedding(&library, 10)
        .await
        .unwrap();
    assert_eq!(
        pending.iter().map(|n| n.text.as_str()).collect::<Vec<_>>(),
        vec!["Second words"]
    );
}

// M1b-8 AC-4: two saves close together, and the first one's inference
// finishing last, mustn't leave the older words' vector standing.
#[tokio::test]
async fn a_vector_of_words_since_replaced_is_not_kept() {
    let state = opened("raced").await;
    save_source_note_in(&state, note(NOTE, BOOK, "Old words"))
        .await
        .unwrap();
    let library = state.library().await.unwrap();
    let read_before_the_edit = queries::source_note_to_embed(&library, NOTE)
        .await
        .unwrap()
        .unwrap();

    save_source_note_in(&state, note(NOTE, BOOK, "New words"))
        .await
        .unwrap();
    let asked = Arc::new(AtomicUsize::new(0));
    assert!(embed_source_note_with(&state, NOTE, model(&asked))
        .await
        .unwrap());

    // The slower embed of the old words lands now, and is refused.
    assert!(
        !queries::save_source_note_embedding(&library, &read_before_the_edit, &[0.0, 1.0])
            .await
            .unwrap()
    );
    assert!(queries::source_note_to_embed(&library, NOTE)
        .await
        .unwrap()
        .is_none());
}

fn found(hits: &[queries::Hit]) -> Vec<(&'static str, String)> {
    hits.iter()
        .map(|hit| match hit {
            queries::Hit::Annotation(mark) => ("mark", mark.annotation.id.clone()),
            queries::Hit::SourceNote(note) => ("note", note.note.id.clone()),
            queries::Hit::Chunk(chunk) => ("passage", chunk.idx.to_string()),
        })
        .collect()
}

// M1b-8 AC-4
#[tokio::test]
async fn a_search_by_words_finds_source_notes_beside_marks() {
    let state = opened("words").await;
    attach_pdf(&state).await;
    mark(&state, "m1", 3).await;
    save_source_note_in(
        &state,
        queries::NewSourceNote {
            quote: Some("Writing restructures consciousness, says Ong.".into()),
            ..note(NOTE, BOOK, "The chapter's thesis")
        },
    )
    .await
    .unwrap();
    save_source_note_in(&state, note("other", BOOK, "Nothing to do with it"))
        .await
        .unwrap();

    let by_quote = search_notes_literally_in(&state, "restructures".into(), 10)
        .await
        .unwrap();
    let mut kinds = found(&by_quote);
    kinds.sort();
    assert_eq!(kinds, vec![("mark", "m1".into()), ("note", NOTE.into())]);

    let by_body = search_notes_literally_in(&state, "thesis".into(), 10)
        .await
        .unwrap();
    assert_eq!(found(&by_body), vec![("note", NOTE.into())]);
    let queries::Hit::SourceNote(hit) = &by_body[0] else {
        unreachable!()
    };
    // Named by the work, which a book entered by hand has and a file name
    // doesn't, and cited as the work.
    assert_eq!(hit.title.as_deref(), Some("Orality and Literacy"));
    assert_eq!(hit.source_id, BOOK);
    assert!(hit.in_project);

    // A backslash is a character like any other, even last.
    save_source_note_in(&state, note("path", BOOK, r"Kept in C:\notes\"))
        .await
        .unwrap();
    let by_backslash = search_notes_literally_in(&state, r"notes\".into(), 10)
        .await
        .unwrap();
    assert_eq!(found(&by_backslash), vec![("note", "path".into())]);
    delete_source_note_in(&state, "path".into()).await.unwrap();

    // Nothing asked: every note of both kinds, as browsing shows them.
    let everything = search_notes_literally_in(&state, "".into(), 10)
        .await
        .unwrap();
    assert_eq!(everything.len(), 3);
}

// M1b-8 AC-4: and so in the follow list, which searches by meaning.
#[tokio::test]
async fn a_search_by_meaning_finds_an_embedded_source_note() {
    let state = opened("meaning").await;
    save_source_note_in(&state, note(NOTE, BOOK, "The chapter's thesis"))
        .await
        .unwrap();
    let asked = Arc::new(AtomicUsize::new(0));
    embed_source_note_with(&state, NOTE, model(&asked))
        .await
        .unwrap();

    let hits = search_notes_in(&state, &[1.0, 0.0], 10).await.unwrap();

    assert_eq!(found(&hits), vec![("note", NOTE.into())]);
    let queries::Hit::SourceNote(hit) = &hits[0] else {
        unreachable!()
    };
    assert_eq!(hit.title.as_deref(), Some("Orality and Literacy"));
}

// M1b-8 AC-5
#[tokio::test]
async fn every_source_note_is_listed_for_the_export() {
    let state = opened("export").await;
    save_source_note_in(&state, note(NOTE, BOOK, "First"))
        .await
        .unwrap();
    save_source_note_in(&state, note("second", BOOK, "Second"))
        .await
        .unwrap();

    let library = state.library().await.unwrap();
    let all = queries::all_source_notes(&library).await.unwrap();

    assert_eq!(
        all.iter().map(|n| n.note.body.as_str()).collect::<Vec<_>>(),
        vec!["First", "Second"]
    );
    // Named, so a work outside the open project isn't "Unknown paper".
    assert!(all
        .iter()
        .all(|n| n.title.as_deref() == Some("Orality and Literacy")));
}
