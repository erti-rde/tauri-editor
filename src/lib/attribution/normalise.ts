/**
 * Words as the attribution check compares them (M4-3 AC-1, ADR 006).
 *
 * The TypeScript twin of `src-tauri/src/attribution/normalise.rs`. The Rust
 * matcher reports where a span sits as word indices, and the classifier
 * reads those indices against the words this returns, so the two must agree
 * word for word. Both are tested against
 * `tests/fixtures/attribution/normalise.json`.
 *
 * The steps:
 * 1. NFKC, which also undoes ligatures, full-width forms and the no-break
 *    space.
 * 2. Split into runs of letters and digits; everything else separates words.
 *    A soft hyphen or zero-width character inside a word is dropped. A hyphen
 *    after a letter, then space, then a lower-case letter is a word broken
 *    across a line, and is joined.
 * 3. Lower-case, with `ß` as `ss` and a final `ς` as `σ`.
 */

const WORD_CHAR = /[\p{Alphabetic}\p{N}]/u;
const LETTER = /\p{Alphabetic}/u;
const LOWER = /\p{Lowercase}/u;
const SPACE = /\p{White_Space}/u;
// Written as escapes: the characters themselves are invisible, and an editor
// that dropped one would leave every test passing.
const SOFT_HYPHEN = '\u00AD';
const JOINERS = new Set([SOFT_HYPHEN, '\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF']);
const HYPHENS = new Set(['-', '\u2010', SOFT_HYPHEN]);

function fold(token: string): string {
	return token.toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ');
}

/** A character after NFKC, and the stretch of the original text it came from. */
interface Unit {
	char: string;
	start: number;
	end: number;
}

/** A word, and where it is in the text it was read from. */
export interface WordSpan {
	word: string;
	/** UTF-16 offsets into the original text, `[start, end)`. */
	start: number;
	end: number;
}

/** Every word of `text`, normalised. */
export function words(text: string): string[] {
	// By code point, as Rust iterates chars: a letter outside the BMP is one.
	const units = Array.from(text.normalize('NFKC'), (char) => ({ char, start: 0, end: 0 }));
	return tokenise(units).map((w) => w.word);
}

/**
 * Every word of `text` with its offsets in `text`, for finding the words a
 * span names in what the writer wrote (M4-5, M4-6).
 *
 * NFKC is applied a character at a time, with any combining marks after it,
 * so each word can be traced back. That agrees with `words` on every text
 * the fixture holds; a caller that needs to be sure compares the two.
 */
export function wordSpans(text: string): WordSpan[] {
	const units: Unit[] = [];
	const clusters = text.match(/\P{M}\p{M}*|\p{M}+/gsu) ?? [];
	let offset = 0;
	for (const cluster of clusters) {
		const end = offset + cluster.length;
		for (const char of cluster.normalize('NFKC')) units.push({ char, start: offset, end });
		offset = end;
	}
	return tokenise(units);
}

function tokenise(units: Unit[]): WordSpan[] {
	const out: WordSpan[] = [];
	let token = '';
	let start = 0;
	let end = 0;

	const emit = () => {
		if (token.length > 0) out.push({ word: fold(token), start, end });
		token = '';
	};

	for (let i = 0; i < units.length; i++) {
		const { char: c } = units[i];
		if (WORD_CHAR.test(c)) {
			if (token.length === 0) start = units[i].start;
			token += c;
			end = units[i].end;
		} else if (HYPHENS.has(c) && token.length > 0 && LETTER.test(Array.from(token).at(-1)!)) {
			let j = i + 1;
			while (j < units.length && SPACE.test(units[j].char)) j++;
			if (j > i + 1 && j < units.length && LOWER.test(units[j].char)) {
				// A word broken across a line: carry on with the same word.
				i = j - 1;
				continue;
			}
			// A soft hyphen inside a word is dropped; any other hyphen ends it.
			if (c !== SOFT_HYPHEN) emit();
		} else if (JOINERS.has(c)) {
			// Inside a word it is dropped; between words there is nothing to drop.
		} else {
			emit();
		}
	}
	emit();
	return out;
}

/** The words joined by single spaces: what two texts must agree on to match. */
export function normalise(text: string): string {
	return words(text).join(' ');
}
