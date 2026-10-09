//! The labelled sets `eval_retrieval` scores, checked for shape without the
//! model or the fetched corpus, so a broken label fails here rather than
//! reading as a miss in a benchmark run.

use serde_json::Value;
use std::collections::HashSet;
use std::path::PathBuf;

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/retrieval")
        .join(name);
    serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap()
}

fn strings<'a>(items: &'a Value, field: &str) -> Vec<&'a str> {
    items
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item[field].as_str().unwrap())
        .collect()
}

// M2-3 AC-1
#[test]
fn at_least_thirty_paragraphs_each_name_the_note_written_about_it() {
    let queries = fixture("queries.json");
    let corpus = fixture("corpus.json");
    let papers: HashSet<&str> = strings(&corpus, "id").into_iter().collect();

    let notes = &queries["notes"];
    let ids = strings(notes, "id");
    let unique: HashSet<&str> = ids.iter().copied().collect();
    assert_eq!(unique.len(), ids.len(), "note ids repeat");

    for note in notes.as_array().unwrap() {
        let source = note["source"].as_str().unwrap();
        assert!(papers.contains(source), "{source} isn't in the corpus");
        assert!(!note["body"].as_str().unwrap().trim().is_empty());
        // A mark is its quote; a source note may have none.
        match note["kind"].as_str().unwrap() {
            "mark" => assert!(!note["quote"].as_str().unwrap().trim().is_empty()),
            "source_note" => {}
            other => panic!("{other} isn't a kind of note"),
        }
    }

    let pairs = &queries["note_queries"];
    let golds = strings(pairs, "gold");
    assert!(golds.len() >= 30, "only {} labelled pairs", golds.len());
    for gold in &golds {
        assert!(unique.contains(gold), "{gold} names no note");
    }
    // The rest are decoys: other points from the same papers, there to be
    // ranked against.
    assert!(unique.len() > golds.iter().collect::<HashSet<_>>().len());

    // The paper-retrieval set is unchanged in size, so the baseline compares.
    assert_eq!(queries["queries"].as_array().unwrap().len(), 65);
}
