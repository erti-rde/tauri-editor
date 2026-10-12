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
const JOINERS = new Set(['­', '​', '‌', '‍', '⁠', '﻿']);
const HYPHENS = new Set(['-', '‐', '­']);

function fold(token: string): string {
	return token.toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ');
}

/** Every word of `text`, normalised. */
export function words(text: string): string[] {
	// By code point, as Rust iterates chars: a letter outside the BMP is one.
	const chars = Array.from(text.normalize('NFKC'));
	const out: string[] = [];
	let token = '';

	const emit = () => {
		if (token.length > 0) out.push(fold(token));
		token = '';
	};

	for (let i = 0; i < chars.length; i++) {
		const c = chars[i];
		if (WORD_CHAR.test(c)) {
			token += c;
		} else if (HYPHENS.has(c) && token.length > 0 && LETTER.test(Array.from(token).at(-1)!)) {
			let j = i + 1;
			while (j < chars.length && SPACE.test(chars[j])) j++;
			if (j > i + 1 && j < chars.length && LOWER.test(chars[j])) {
				// A word broken across a line: carry on with the same word.
				i = j - 1;
				continue;
			}
			// A soft hyphen inside a word is dropped; any other hyphen ends it.
			if (c !== '­') emit();
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
