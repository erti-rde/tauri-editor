import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import * as copy from './copy';
import { FINDING_KINDS } from './classify';

/**
 * The Check panel's words, held to docs/ux.md Principles 2 and 3 (M4-8).
 *
 * The panel states what the words match and says which kind of nothing it
 * has; it never passes a verdict on the writer or puts a number on them.
 */

/** Words a verdict is made of. A score in any form, and the word for theft. */
const VERDICTS = [
	/plagiari/i,
	/violat/i,
	/\bscore/i,
	/%/,
	/percent/i,
	/no problems/i,
	/\bfound no\b/i
];

/** Every string the module holds or makes, with sample arguments. */
function strings(): string[] {
	const out: string[] = [];
	for (const value of Object.values(copy)) {
		if (typeof value === 'string') out.push(value);
		else if (typeof value === 'function') {
			// Called with a count and with words, whichever it takes.
			const make = value as (...args: unknown[]) => unknown;
			out.push(String(make(2)), String(make('x')));
		} else if (value && typeof value === 'object') out.push(...Object.values(value).map(String));
	}
	out.push(copy.scopeLine({ sentences: 142, sources: 23, documents: 2 }));
	return out;
}

describe('the Check panel’s words', () => {
	// M4-8 AC-2
	it('hold no verdict, score or percentage', () => {
		for (const text of strings()) {
			for (const verdict of VERDICTS) expect(text, text).not.toMatch(verdict);
		}
	});

	// M4-8 AC-2
	it('are the only words the panel shows', () => {
		// Strings typed into the component would escape the test above.
		const panel = readFileSync(join(__dirname, 'CheckPanel.svelte'), 'utf8');
		const markup = panel.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
		const text = markup
			.replace(/\{[^}]*\}/g, '')
			.replace(/<[^>]*>/g, '')
			.trim();
		expect(text).toBe('');
		// Comments may name what the panel never says; the code may not.
		const code = panel
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/^\s*\/\/.*$/gm, '');
		for (const verdict of VERDICTS) expect(code).not.toMatch(verdict);
	});

	// M4-5 AC-3
	it('title every kind of finding in words', () => {
		for (const kind of FINDING_KINDS) expect(copy.GROUP_TITLES[kind]).toMatch(/^[A-Z][a-z ,]+$/);
	});

	// M4-5 AC-2
	it('give the scope as counts, in words that agree with them', () => {
		expect(copy.scopeLine({ sentences: 142, sources: 23, documents: 2 })).toBe(
			'142 sentences checked against 23 sources in your library and 2 other documents in this project.'
		);
		expect(copy.scopeLine({ sentences: 1, sources: 1, documents: 1 })).toBe(
			'1 sentence checked against 1 source in your library and 1 other document in this project.'
		);
		expect(copy.scopeLine({ sentences: 3, sources: 0, documents: 0 })).toBe(
			'3 sentences checked against 0 sources in your library.'
		);
	});

	// M4-5 AC-2
	it('say nothing to review in the fixed words, never “no problems found”', () => {
		expect(copy.NOTHING_TO_REVIEW).toBe('Nothing to review in the sentences checked.');
		expect(copy.NOTHING_TO_REVIEW_DETAIL).toBe('This only covers sources in your library.');
	});
});
