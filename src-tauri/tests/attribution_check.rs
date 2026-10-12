//! The attribution check's matching, through the command (M4-3, ADR 006): one
//! pass over the library's chunks, the quotes of marks and source notes, and
//! the project's other manuscripts.

use erti_lib::attribution::PassageKind;
use erti_lib::db::{queries, DbState};
use erti_lib::db_commands::{add_source_by_hand_in, check_attribution_in, store_chunks_in};

const PAPER: &str = "a11ce000a11ce000a11ce000a11ce000a11ce000a11ce000a11ce000a11ce000";
/// A second file of the book below, aliased to it.
const SCAN: &str = "b0b00000b0b00000b0b00000b0b00000b0b00000b0b00000b0b00000b0b00000";
const BOOK: &str = "erti:0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

const FROM_PAPER: &str = "We propose a new simple network architecture, the Transformer, based solely on \
                          attention mechanisms, dispensing with recurrence and convolutions entirely.";
const FROM_SCAN: &str =
    "Every index is an argument about what a reader will want to find, made before \
                         the reader arrives.";
const MARKED: &str = "Self-attention could yield more interpretable models than recurrent ones.";
const NOTED: &str = "Oral structures look to pragmatics where written ones look to syntax.";
const OTHER_CHAPTER: &str =
    "Retrieval systems have always encoded a view of what their users need.";
const THIS_CHAPTER: &str = "This sentence is in the manuscript being checked and nowhere else.";

struct World {
    state: DbState,
}

fn chunk(text: &str, page: i64) -> queries::NewChunk {
    queries::NewChunk {
        text: text.into(),
        embedding: vec![1.0, 0.0],
        page_start: Some(page),
        page_end: Some(page),
        section: None,
        char_start: None,
        char_end: None,
    }
}

fn manuscript(text: &str) -> String {
    serde_json::json!({
        "type": "doc",
        "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": text }] }]
    })
    .to_string()
}

async fn world(name: &str) -> World {
    let dir = std::env::temp_dir().join(format!("erti-attribution-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let project = dir.join("project");

    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await.unwrap();
    state.open_project(&project).await.unwrap();
    let library = state.library().await.unwrap();

    queries::register_source(&library, PAPER, "/papers/vaswani.pdf", "vaswani.pdf")
        .await
        .unwrap();
    add_source_by_hand_in(
        &state,
        BOOK.into(),
        r#"{"type":"book","title":"Indexes"}"#.into(),
        "book".into(),
    )
    .await
    .unwrap();
    queries::register_source(&library, SCAN, "/papers/scan.pdf", "scan.pdf")
        .await
        .unwrap();
    queries::alias_source(&library, SCAN, BOOK).await.unwrap();

    store_chunks_in(
        &state,
        PAPER,
        &[
            chunk("An unrelated opening passage about other things.", 1),
            chunk(FROM_PAPER, 2),
        ],
    )
    .await
    .unwrap();
    store_chunks_in(&state, SCAN, &[chunk(FROM_SCAN, 41)])
        .await
        .unwrap();

    let mark: queries::NewAnnotation = serde_json::from_value(serde_json::json!({
        "id": "mark-1", "sha256": PAPER, "kind": "highlight", "page": 9, "quote": MARKED
    }))
    .unwrap();
    queries::save_annotation(&library, &mark).await.unwrap();
    queries::save_source_note(
        &library,
        &queries::NewSourceNote {
            id: "note-1".into(),
            sha256: BOOK.into(),
            body: "For the introduction.".into(),
            quote: Some(NOTED.into()),
            page_label: Some("xii".into()),
            label_id: None,
        },
    )
    .await
    .unwrap();

    std::fs::write(
        project.join("chapter-1.erti.json"),
        manuscript(THIS_CHAPTER),
    )
    .unwrap();
    std::fs::write(
        project.join("chapter-2.erti.json"),
        manuscript(OTHER_CHAPTER),
    )
    .unwrap();
    // Not a manuscript, and not valid JSON either: passed over.
    std::fs::write(project.join("notes.erti.json"), "{ half-written").unwrap();
    std::fs::write(project.join("data.json"), manuscript(OTHER_CHAPTER)).unwrap();

    World { state }
}

async fn check(w: &World, sentences: &[&str]) -> erti_lib::attribution::AttributionMatches {
    check_attribution_in(
        &w.state,
        Some("chapter-1.erti.json".into()),
        sentences.iter().map(|s| s.to_string()).collect(),
    )
    .await
    .unwrap()
}

// M4-3 AC-2
#[tokio::test]
async fn finds_each_kind_of_corpus_text_in_one_pass() {
    let w = world("kinds").await;
    let found = check(
        &w,
        &[
            &format!("As they put it, {}", FROM_PAPER.to_lowercase()),
            "A sentence of the writer's own that nothing in the library shares.",
            &format!("“{MARKED}”"),
            &format!("Ong notes that {}", NOTED.to_lowercase()),
            OTHER_CHAPTER,
            &format!("The book says {FROM_SCAN}"),
        ],
    )
    .await;

    let by_sentence = |i: u32| {
        found
            .spans
            .iter()
            .filter(|s| s.sentence == i)
            .map(|s| &found.passages[s.passage as usize])
            .collect::<Vec<_>>()
    };

    let paper = by_sentence(0);
    assert_eq!(paper.len(), 1);
    assert_eq!(paper[0].kind, PassageKind::Chunk);
    assert_eq!(paper[0].work, PAPER);
    assert_eq!(paper[0].file.as_deref(), Some(PAPER));
    assert_eq!(paper[0].page, Some(2));

    assert!(by_sentence(1).is_empty());

    let marked = by_sentence(2);
    assert_eq!(marked.len(), 1);
    assert_eq!(marked[0].kind, PassageKind::Mark);
    assert_eq!(marked[0].id.as_deref(), Some("mark-1"));
    assert_eq!(marked[0].page, Some(9));

    let noted = by_sentence(3);
    assert_eq!(noted.len(), 1);
    assert_eq!(noted[0].kind, PassageKind::Note);
    assert_eq!(noted[0].work, BOOK);
    assert_eq!(noted[0].file, None, "a note is on the work, not a file");
    assert_eq!(noted[0].page_label.as_deref(), Some("xii"));

    let reused = by_sentence(4);
    assert_eq!(reused.len(), 1);
    assert_eq!(reused[0].kind, PassageKind::Document);
    assert_eq!(reused[0].work, "chapter-2.erti.json");

    // The scan's chunk is reported as the book's: the work to cite (ADR 003).
    let scanned = by_sentence(5);
    assert_eq!(scanned.len(), 1);
    assert_eq!(scanned[0].work, BOOK);
    assert_eq!(scanned[0].file.as_deref(), Some(SCAN));
    assert_eq!(scanned[0].page, Some(41));

    // Three chunks, a mark, a note, and one paragraph of the other chapter.
    assert_eq!(found.read, 6);
    // M4-5 AC-2: what the scope line says was read. The scan's chunks count
    // as the book's, and the mark is on the paper: two works.
    assert_eq!((found.sources, found.documents), (2, 1));
    // Only the five passages a span names cross back, not the unrelated chunk.
    assert_eq!(found.passages.len(), 5);
}

// M4-3 AC-3
#[tokio::test]
async fn returns_only_the_passages_a_span_still_names() {
    let w = world("named").await;
    // Two overlapping chunks of one paper both hold the sentence's words. One
    // span is kept, the longer, and only its passage crosses back.
    let overlap = "c1c1a000c1c1a000c1c1a000c1c1a000c1c1a000c1c1a000c1c1a000c1c1a000";
    let library = w.state.library().await.unwrap();
    queries::register_source(&library, overlap, "/papers/overlap.pdf", "overlap.pdf")
        .await
        .unwrap();
    let words = "Catalogues have long shaped the questions a reader thinks to ask of them.";
    store_chunks_in(
        &w.state,
        overlap,
        &[
            chunk(&format!("An earlier passage ends where {words}"), 3),
            chunk(
                "Catalogues have long shaped the questions a reader thinks",
                4,
            ),
        ],
    )
    .await
    .unwrap();

    let found = check(&w, &[words]).await;

    assert_eq!(found.spans.len(), 1);
    assert_eq!(found.passages.len(), 1, "{:?}", found.passages);
    assert_eq!(found.passages[0].page, Some(3));
    assert_eq!(found.spans[0].passage, 0);
}

// M4-3 AC-2
#[tokio::test]
async fn does_not_match_the_manuscript_against_itself() {
    let w = world("itself").await;
    let found = check(&w, &[THIS_CHAPTER]).await;
    assert!(found.spans.is_empty(), "{:?}", found.spans);
}

// M4-3 AC-2
#[tokio::test]
async fn reads_nothing_when_no_sentence_is_long_enough_to_match() {
    let w = world("short").await;
    let found = check(&w, &["Too short.", "Five words are not enough."]).await;
    assert_eq!(found.read, 0);
    assert_eq!((found.sources, found.documents), (0, 0));
    assert!(found.spans.is_empty());
}

// M4-3 AC-2
#[tokio::test]
async fn reads_every_page_of_a_large_library() {
    let w = world("pages").await;
    // More chunks than one page of the stream, with the match on the last.
    let mut chunks: Vec<queries::NewChunk> = (0..2_500)
        .map(|i| {
            chunk(
                &format!("Filler passage number {i} says little of note."),
                i,
            )
        })
        .collect();
    chunks.push(chunk(
        "The very last chunk carries a sentence no other passage has ever held.",
        2_500,
    ));
    let library = w.state.library().await.unwrap();
    let many = "c0c0a000c0c0a000c0c0a000c0c0a000c0c0a000c0c0a000c0c0a000c0c0a000";
    queries::register_source(&library, many, "/papers/many.pdf", "many.pdf")
        .await
        .unwrap();
    store_chunks_in(&w.state, many, &chunks).await.unwrap();

    let found = check(
        &w,
        &["The very last chunk carries a sentence no other passage has ever held."],
    )
    .await;

    assert_eq!(found.read, 6 + 2_501);
    assert_eq!(found.spans.len(), 1);
    assert_eq!(found.passages[0].page, Some(2_500));
}
