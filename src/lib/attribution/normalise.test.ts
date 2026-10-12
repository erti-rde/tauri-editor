import { describe, expect, it } from 'vitest';

import shared from '../../../tests/fixtures/attribution/normalise.json';
import { normalise, words } from './normalise';

describe('normalising words for the attribution check', () => {
	// M4-3 AC-1
	it('agrees with the cases the Rust matcher is held to', () => {
		for (const { text, words: expected } of shared.cases) {
			expect(words(text), text).toEqual(expected);
		}
	});

	// M4-3 AC-1
	it('is idempotent', () => {
		for (const { text } of shared.cases) {
			const once = normalise(text);
			expect(normalise(once), text).toBe(once);
		}

		// And on text no one chose, from the characters the rules are about.
		const alphabet = Array.from(
			'aZß5 -\u00AD\u200B\u2010\u2011\uFB01\uFB02’“”—–\u00A0\nΣςéè\u0301.,'
		);
		let seed = 0x2545f491;
		const next = () => {
			seed ^= seed << 13;
			seed ^= seed >>> 17;
			seed ^= seed << 5;
			return (seed >>> 0) % alphabet.length;
		};
		for (let n = 0; n < 2000; n++) {
			const text = Array.from({ length: 24 }, () => alphabet[next()]).join('');
			const once = normalise(text);
			expect(normalise(once), JSON.stringify(text)).toBe(once);
		}
	});

	// M4-3 AC-1
	it('makes text pasted from a PDF read as the extracted text does', () => {
		expect(normalise('The \uFB01nal net\u00ADworks are di\uFB00erent')).toBe(
			normalise('the final networks are different')
		);
		expect(normalise('recur- rence')).toBe('recurrence');
	});
});
