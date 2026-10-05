//! A source added from a DOI (M1b-6, docs/ux.md UX-2): its details looked up,
//! then kept as a work with no file. A DOI the library has already finds that
//! work instead of making a second.

use erti_lib::db::{queries, DbState};
use erti_lib::db_commands::{add_source_by_hand_in, add_source_from_doi_in, source_for_doi_in};
use erti_lib::ipc::ErrorKind;
use sqlx::Row;

const ID: &str = "erti:7a2d4b63-9e1f-4d2c-8b8f-3c6e5a4f2b02";
const OTHER: &str = "erti:8b3e5c74-0f2a-4e3d-9c9a-4d7f6b5a3c03";
const PAPER: &str = r#"{"type":"article-journal","title":"Deep learning","DOI":"10.1038/nature14539","author":[{"family":"LeCun","given":"Yann"}]}"#;

async fn opened(name: &str) -> DbState {
    let dir = std::env::temp_dir().join(format!("erti-from-doi-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let state = DbState::default();
    state.open_library(&dir.join("library.db")).await.unwrap();
    state.open_project(&dir.join("project")).await.unwrap();
    state
}

// M1b-6 AC-1
#[tokio::test]
async fn a_looked_up_source_joins_the_library_and_the_project_with_its_doi() {
    let state = opened("adds").await;

    add_source_from_doi_in(&state, ID.into(), PAPER.into(), "journalArticle".into())
        .await
        .unwrap();

    let library = state.library().await.unwrap();
    let row = sqlx::query("SELECT doi, resolved_via FROM sources WHERE sha256 = ?")
        .bind(ID)
        .fetch_one(&library)
        .await
        .unwrap();
    assert_eq!(row.get::<String, _>("doi"), "10.1038/nature14539");
    assert_eq!(
        row.get::<String, _>("resolved_via"),
        "manual",
        "a DOI typed by hand, its details fetched"
    );

    let project = state.project().await.unwrap();
    let listed = queries::project_sources(&library, &project).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].sha256, ID);
    assert_eq!(listed[0].state, "ready");
}

// M1b-6 AC-1
#[tokio::test]
async fn details_without_a_doi_are_not_from_one() {
    let state = opened("no-doi").await;
    let err = add_source_from_doi_in(
        &state,
        ID.into(),
        r#"{"type":"book","title":"Orality and Literacy"}"#.into(),
        "book".into(),
    )
    .await
    .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
}

// M1b-6 AC-3
#[tokio::test]
async fn a_doi_in_the_library_is_found_whatever_its_case() {
    let state = opened("finds").await;
    add_source_from_doi_in(&state, ID.into(), PAPER.into(), "journalArticle".into())
        .await
        .unwrap();

    for doi in [
        "10.1038/nature14539",
        "10.1038/NATURE14539",
        " 10.1038/nature14539 ",
    ] {
        assert_eq!(
            source_for_doi_in(&state, doi.into())
                .await
                .unwrap()
                .as_deref(),
            Some(ID),
            "{doi}"
        );
    }
    assert_eq!(
        source_for_doi_in(&state, "10.1038/other".into())
            .await
            .unwrap(),
        None
    );
    assert_eq!(source_for_doi_in(&state, "".into()).await.unwrap(), None);
}

// M1b-6 AC-3
#[tokio::test]
async fn a_doi_only_in_the_details_is_found_too() {
    let state = opened("in-details").await;
    // By hand, with the DOI typed into the form's field.
    add_source_by_hand_in(&state, ID.into(), PAPER.into(), "journalArticle".into())
        .await
        .unwrap();
    // And from a manuscript, whose snapshot names no DOI column.
    let library = state.library().await.unwrap();
    queries::add_source_without_file(
        &library,
        OTHER,
        r#"{"type":"book","title":"Writing Culture","DOI":"10.1525/9780520946286"}"#,
        None,
        None,
    )
    .await
    .unwrap();

    assert_eq!(
        source_for_doi_in(&state, "10.1038/nature14539".into())
            .await
            .unwrap()
            .as_deref(),
        Some(ID)
    );
    assert_eq!(
        source_for_doi_in(&state, "10.1525/9780520946286".into())
            .await
            .unwrap()
            .as_deref(),
        Some(OTHER)
    );
}

// M1b-6 AC-3, ADR 003
#[tokio::test]
async fn a_doi_read_from_an_attached_pdf_finds_the_work() {
    let state = opened("alias").await;
    add_source_by_hand_in(
        &state,
        ID.into(),
        r#"{"type":"article-journal","title":"Deep learning"}"#.into(),
        "journalArticle".into(),
    )
    .await
    .unwrap();
    let library = state.library().await.unwrap();
    let pdf = "c".repeat(64);
    queries::register_source(&library, &pdf, "/papers/lecun.pdf", "lecun.pdf")
        .await
        .unwrap();
    queries::set_source_metadata(
        &library,
        &pdf,
        PAPER,
        Some("journalArticle"),
        Some("10.1038/nature14539"),
        "pdf-doi",
    )
    .await
    .unwrap();
    queries::alias_source(&library, &pdf, ID).await.unwrap();

    assert_eq!(
        source_for_doi_in(&state, "10.1038/nature14539".into())
            .await
            .unwrap()
            .as_deref(),
        Some(ID),
        "the work the PDF is a file of, not the PDF"
    );
}

#[tokio::test]
async fn unreadable_details_are_passed_over_not_an_error() {
    let state = opened("unreadable").await;
    let library = state.library().await.unwrap();
    queries::add_source_without_file(&library, OTHER, "{not json", None, None)
        .await
        .unwrap();

    assert_eq!(
        source_for_doi_in(&state, "10.1038/nature14539".into())
            .await
            .unwrap(),
        None
    );
}

// M1b-6 AC-3
#[tokio::test]
async fn a_second_source_with_the_same_doi_is_refused_and_not_kept() {
    let state = opened("twice").await;
    add_source_from_doi_in(&state, ID.into(), PAPER.into(), "journalArticle".into())
        .await
        .unwrap();

    let looked_up = add_source_from_doi_in(
        &state,
        OTHER.into(),
        PAPER.replace("nature14539", "NATURE14539"),
        "journalArticle".into(),
    )
    .await
    .unwrap_err();
    assert_eq!(looked_up.kind, ErrorKind::Conflict);
    let by_hand =
        add_source_by_hand_in(&state, OTHER.into(), PAPER.into(), "journalArticle".into())
            .await
            .unwrap_err();
    assert_eq!(by_hand.kind, ErrorKind::Conflict);

    let library = state.library().await.unwrap();
    let kept: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sources WHERE sha256 = ?")
        .bind(OTHER)
        .fetch_one(&library)
        .await
        .unwrap();
    assert_eq!(kept, 0);
}
