//! Notes on a source (M1b-8, ADR 004, docs/ux.md UX-3): written on the work,
//! listed with the marks on each of its files.

use erti_lib::db::{queries, DbState};
use erti_lib::db_commands::{
    add_source_by_hand_in, delete_source_note_in, save_source_note_in, work_notes_in,
};
use erti_lib::ipc::ErrorKind;

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
