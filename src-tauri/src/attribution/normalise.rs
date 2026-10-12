//! Words as the attribution check compares them (M4-3 AC-1, ADR 006).
//!
//! Both sides of a match go through this: the manuscript's sentences and every
//! passage of the corpus. The classifier repeats it in TypeScript
//! (`src/lib/attribution/normalise.ts`), and the two are held to the same
//! cases in `tests/fixtures/attribution/normalise.json`, so a word index from
//! here means the same word there.
//!
//! The steps, in order:
//! 1. NFKC, which also undoes ligatures (`ﬁ` → `fi`), full-width forms and
//!    the no-break space.
//! 2. Split into words: runs of letters and digits. Everything else separates
//!    words, so quotation marks, apostrophes, dashes and punctuation of every
//!    kind are unified by being dropped.
//!    - A soft hyphen or a zero-width character inside a word is dropped
//!      without ending it.
//!    - A hyphen after a letter, then space, then a lower-case letter is a word
//!      broken across a line (`net- works`), and is joined.
//! 3. Lower-case, then fold the two letters lower-casing leaves apart: `ß` is
//!    `ss` and a final `ς` is `σ`.

use tokenizers::NormalizedString;

/// Dropped inside a word without ending it: what PDF text and pasting leave.
fn is_joiner(c: char) -> bool {
    matches!(
        c,
        '\u{00AD}' | '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{2060}' | '\u{FEFF}'
    )
}

/// A hyphen that may break a word across a line. NFKC has already made the
/// non-breaking hyphen an ordinary U+2010.
fn is_hyphen(c: char) -> bool {
    matches!(c, '-' | '\u{2010}' | '\u{00AD}')
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric()
}

fn nfkc(text: &str) -> std::borrow::Cow<'_, str> {
    // ASCII is already in NFKC, and most of the corpus is ASCII.
    if text.is_ascii() {
        return std::borrow::Cow::Borrowed(text);
    }
    // Only the pieces between spaces that aren't ASCII go through NFKC. An
    // ASCII space never composes with what's either side of it, so this is
    // the same as normalising the whole text, and a passage with one curly
    // quote doesn't pay for the other 400 characters.
    let mut out = String::with_capacity(text.len());
    for piece in text.split_inclusive(' ') {
        if piece.is_ascii() {
            out.push_str(piece);
        } else {
            let mut normalized = NormalizedString::from(piece);
            normalized.nfkc();
            out.push_str(normalized.get());
        }
    }
    std::borrow::Cow::Owned(out)
}

/// Call `each` with every word of `text`, normalised.
///
/// A callback rather than a `Vec`, so the matcher can hash a passage's words
/// without allocating one string per word.
pub fn each_word(text: &str, mut each: impl FnMut(&str)) {
    let text = nfkc(text);
    let chars: Vec<char> = text.chars().collect();
    let mut token = String::new();
    let mut word = String::new();

    let mut emit = |token: &mut String| {
        if token.is_empty() {
            return;
        }
        word.clear();
        for c in token.chars().flat_map(char::to_lowercase) {
            match c {
                'ß' => word.push_str("ss"),
                'ς' => word.push('σ'),
                _ => word.push(c),
            }
        }
        each(&word);
        token.clear();
    };

    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if is_word_char(c) {
            token.push(c);
        } else if is_hyphen(c) && token.chars().last().is_some_and(char::is_alphabetic) {
            let mut j = i + 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if j > i + 1 && j < chars.len() && chars[j].is_lowercase() {
                // A word broken across a line: carry on with the same word.
                i = j;
                continue;
            }
            if c == '\u{00AD}' {
                // A soft hyphen inside a word, not at a break.
            } else {
                emit(&mut token);
            }
        } else if is_joiner(c) {
            // Inside a word it is dropped; between words there is nothing to drop.
        } else {
            emit(&mut token);
        }
        i += 1;
    }
    emit(&mut token);
}

/// Every word of `text`, normalised.
pub fn words(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    each_word(text, |w| out.push(w.to_owned()));
    out
}

/// The words joined by single spaces: what two texts must agree on to match.
pub fn normalise(text: &str) -> String {
    words(text).join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Case {
        text: String,
        words: Vec<String>,
    }

    fn cases() -> Vec<Case> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../tests/fixtures/attribution/normalise.json"
        );
        let file: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).expect("normalise.json"))
                .expect("valid JSON");
        serde_json::from_value(file["cases"].clone()).expect("cases")
    }

    // M4-3 AC-1
    #[test]
    fn agrees_with_the_shared_cases() {
        for case in cases() {
            assert_eq!(words(&case.text), case.words, "{:?}", case.text);
        }
    }

    // M4-3 AC-1
    #[test]
    fn is_idempotent() {
        for case in cases() {
            let once = normalise(&case.text);
            assert_eq!(normalise(&once), once, "{:?}", case.text);
        }

        // And on text no one chose: a seeded mix of the characters the rules
        // are about, so a rule that feeds on its own output shows up.
        let alphabet: Vec<char> =
            "aZß5 -\u{00AD}\u{200B}\u{2010}\u{2011}ﬁﬂ’“”—–\u{00A0}\nΣςéè\u{0301}.,"
                .chars()
                .collect();
        let mut seed: u64 = 0x2545_F491_4F6C_DD1D;
        for _ in 0..2000 {
            let mut text = String::new();
            for _ in 0..24 {
                seed ^= seed << 13;
                seed ^= seed >> 7;
                seed ^= seed << 17;
                text.push(alphabet[(seed % alphabet.len() as u64) as usize]);
            }
            let once = normalise(&text);
            assert_eq!(normalise(&once), once, "{text:?}");
        }
    }

    // M4-3 AC-1
    #[test]
    fn normalises_piece_by_piece_as_it_would_the_whole_text() {
        // Characters whose NFKC form depends on what's next to them: a letter
        // and the accent that composes with it, split by a space or not.
        let alphabet: Vec<char> =
            "e a\u{0301}\u{0308}\u{00B4}\u{FB01}\u{2126}\u{1100}\u{1161}\u{00A0}"
                .chars()
                .collect();
        let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
        for _ in 0..2000 {
            let mut text = String::from("é");
            for _ in 0..16 {
                seed ^= seed << 13;
                seed ^= seed >> 7;
                seed ^= seed << 17;
                text.push(alphabet[(seed % alphabet.len() as u64) as usize]);
            }
            let mut whole = NormalizedString::from(text.as_str());
            whole.nfkc();
            assert_eq!(nfkc(&text), whole.get(), "{text:?}");
        }
    }
}
