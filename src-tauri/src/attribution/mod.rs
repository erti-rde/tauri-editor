//! The attribution check's matching half (M4-3, ADR 006).
//!
//! Pure: sentences and passages in, spans out. The command that streams the
//! library and the project past it is `check_attribution` in `db_commands.rs`;
//! the harness runs the same matcher through `bin/eval_attribution.rs`.

pub mod matcher;
pub mod normalise;

use serde::Serialize;
use serde_json::Value;

pub use matcher::{Matcher, Span};

/// Nodes of a manuscript that aren't the writer's prose: citeproc's words in
/// the reference list and endnotes, the citation labels, and code. The same
/// set the sentence walk skips (`src/lib/attribution/sentences.ts`).
const SKIPPED: [&str; 4] = ["bibliography", "notes", "citation", "codeBlock"];

/// The paragraphs of another manuscript in the project, for self-reuse.
///
/// Read from the saved JSON rather than from an editor, since the other
/// documents aren't open. Each paragraph, heading or cell is one passage, so
/// a span points at the paragraph it came from, not at a whole chapter.
pub fn manuscript_paragraphs(doc: &Value) -> Vec<String> {
    fn walk(node: &Value, out: &mut Vec<String>) {
        let kind = node.get("type").and_then(Value::as_str).unwrap_or("");
        if SKIPPED.contains(&kind) {
            return;
        }
        let Some(children) = node.get("content").and_then(Value::as_array) else {
            return;
        };

        let is_textblock = children
            .iter()
            .any(|child| child.get("type").and_then(Value::as_str) == Some("text"));
        if !is_textblock {
            for child in children {
                walk(child, out);
            }
            return;
        }

        let mut text = String::new();
        for child in children {
            match child.get("type").and_then(Value::as_str) {
                Some("text") => {
                    text.push_str(child.get("text").and_then(Value::as_str).unwrap_or(""))
                }
                Some("citation") => {}
                // A line break or an inline image still separates words.
                _ => text.push(' '),
            }
        }
        let text = text.trim();
        if !text.is_empty() {
            out.push(text.to_owned());
        }
    }

    let mut out = Vec::new();
    walk(doc, &mut out);
    out
}

/// Which kind of text a passage is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum PassageKind {
    /// A paper's text, as ingest chunked it.
    Chunk,
    /// The quote of a highlight.
    Mark,
    /// The quote of a source note.
    Note,
    /// A paragraph of another manuscript in the project.
    Document,
}

/// What a span was matched against.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MatchedPassage {
    pub kind: PassageKind,
    /// The work it belongs to, by canonical id (ADR 003). For a document, its
    /// file name.
    pub work: String,
    /// The file to open it in, by hash: set for chunks and marks.
    pub file: Option<String>,
    /// The mark's or note's id.
    pub id: Option<String>,
    /// The page it starts on, counted from 1.
    pub page: Option<u32>,
    /// The page as printed, for a note.
    pub page_label: Option<String>,
    pub text: String,
}

/// The result of a check: every span, and the passages they name.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AttributionMatches {
    /// `span.passage` is an index into `passages`.
    pub spans: Vec<Span>,
    pub passages: Vec<MatchedPassage>,
    /// How many passages were read, matched or not.
    pub read: u32,
    /// How many works those passages came from, so the panel can say what the
    /// check covered (UX-7's scope line). Every work read, matched or not.
    pub sources: u32,
    /// How many of the project's other documents were read.
    pub documents: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn para(parts: Value) -> Value {
        json!({ "type": "paragraph", "content": parts })
    }

    // M4-3 AC-2
    #[test]
    fn reads_another_manuscripts_paragraphs_without_its_apparatus() {
        let doc = json!({
            "type": "doc",
            "content": [
                { "type": "heading", "attrs": { "level": 1 }, "content": [{ "type": "text", "text": "Chapter one" }] },
                para(json!([
                    { "type": "text", "text": "Indexes encode a view " },
                    { "type": "citation", "attrs": { "id": "[\"a\"]" } },
                    { "type": "text", "text": "of their users." },
                    { "type": "hardBreak" },
                    { "type": "text", "text": "A second line." }
                ])),
                { "type": "bulletList", "content": [
                    { "type": "listItem", "content": [para(json!([{ "type": "text", "text": "An item" }]))] }
                ] },
                { "type": "codeBlock", "content": [{ "type": "text", "text": "x = 1" }] },
                { "type": "notes", "attrs": { "notes": [{ "text": "A note." }] } },
                { "type": "bibliography", "attrs": { "entries": ["Smith (2020)."] } },
                para(json!([{ "type": "citation", "attrs": {} }]))
            ]
        });

        assert_eq!(
            manuscript_paragraphs(&doc),
            vec![
                "Chapter one",
                "Indexes encode a view of their users. A second line.",
                "An item"
            ]
        );
    }

    // M4-3 AC-2
    #[test]
    fn reads_nothing_from_something_that_isnt_a_manuscript() {
        assert!(manuscript_paragraphs(&json!(null)).is_empty());
        assert!(manuscript_paragraphs(&json!({ "type": "doc" })).is_empty());
        assert!(manuscript_paragraphs(&json!([1, 2, 3])).is_empty());
    }
}
