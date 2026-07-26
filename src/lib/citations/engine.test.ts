import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CitationEngine, type CitationCluster } from './engine';
import type { CitationItem } from '$lib/stores/citationStore';

/**
 * Golden-file citation tests.
 *
 * These pin the behaviours citeproc can only produce when it is driven with the
 * document's *whole* ordered citation list — disambiguation, note numbering,
 * short forms, and a bibliography limited to the works actually cited. They are
 * the acceptance criteria for wiring `citationStore` onto this engine.
 *
 * Styles and locale are vendored under tests/fixtures/csl so the suite is
 * hermetic; the app downloads styles at runtime, but tests must not.
 */

const FIXTURES = resolve(process.cwd(), 'tests/fixtures/csl');
const read = (p: string) => readFileSync(resolve(FIXTURES, p), 'utf8');

const sources = JSON.parse(read('sources.json')) as Record<string, CitationItem>;
const localeXml = read('locales/locales-en-US.xml');

function engineFor(style: string) {
	return new CitationEngine({ styleXml: read(`styles/${style}.csl`), localeXml, sources });
}

/** citeproc emits HTML; compare against readable text. */
function plain(html: string): string {
	return html
		.replace(/<[^>]+>/g, '')
		.replace(/&#38;/g, '&')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/\s+/g, ' ')
		.trim();
}

/** Two Smith 2020 papers, a repeated source, and a multi-source cluster. */
const DOCUMENT: CitationCluster[] = [
	{ id: 'c1', itemIds: ['smith-2020-a'] },
	{ id: 'c2', itemIds: ['okafor-2019'] },
	{ id: 'c3', itemIds: ['okafor-2019'] },
	{ id: 'c4', itemIds: ['smith-2020-b'] },
	{ id: 'c5', itemIds: ['smith-2020-a', 'tanaka-2021-book'] }
];

describe('author-date disambiguation', () => {
	// The defect this guards: rendering each citation in isolation cannot know a
	// sibling shares the author and year, so both render "(Smith, 2020)".
	it('appends a/b to same-author same-year sources in APA', () => {
		const rendered = engineFor('apa')
			.render(DOCUMENT)
			.map((r) => plain(r.text));

		expect(rendered[0]).toBe('(Smith, 2020a)');
		expect(rendered[3]).toBe('(Smith, 2020b)');
	});

	it('disambiguates in Chicago author-date too', () => {
		const rendered = engineFor('chicago-author-date')
			.render(DOCUMENT)
			.map((r) => plain(r.text));

		expect(rendered[0]).toBe('(Smith 2020a)');
		expect(rendered[3]).toBe('(Smith 2020b)');
	});

	it('renders a multi-source cluster as one citation', () => {
		const rendered = engineFor('apa')
			.render(DOCUMENT)
			.map((r) => plain(r.text));

		expect(rendered[4]).toBe('(Smith, 2020a; Tanaka, 2021)');
	});
});

describe('note styles', () => {
	// The defect this guards: noteIndex was hardcoded to 0, so note-based styles
	// (Chicago, Turabian — the humanities standard) could not number or shorten.
	it('numbers notes from 1, ascending', () => {
		const rendered = engineFor('chicago-notes-bibliography').render(DOCUMENT);

		expect(rendered.map((r) => r.noteIndex)).toEqual([1, 2, 3, 4, 5]);
	});

	it('gives the first citation in full and later ones in short form', () => {
		const rendered = engineFor('chicago-notes-bibliography')
			.render(DOCUMENT)
			.map((r) => plain(r.text));

		// Note 2 is the first reference to Okafor: full form, with given names.
		expect(rendered[1]).toContain('Chidi Okafor and Marit Lindqvist');
		expect(rendered[1]).toContain('Ocean Modelling');

		// Note 3 repeats it immediately: short form, no given names, no journal.
		expect(rendered[2]).toBe('Okafor and Lindqvist, “Machine Learning for Tidal Prediction.”');
		expect(rendered[2]).not.toContain('Chidi');
	});

	it('shortens a source first cited much earlier', () => {
		const rendered = engineFor('chicago-notes-bibliography')
			.render(DOCUMENT)
			.map((r) => plain(r.text));

		// smith-2020-a was cited at note 1, so note 5 uses the short form.
		expect(rendered[4]).toContain('Smith, “Coastal Erosion under Rising Sea Levels”');
		expect(rendered[4]).not.toContain('Alice Smith, “Coastal Erosion');
	});

	it('uses noteIndex 0 for in-text styles', () => {
		expect(
			engineFor('apa')
				.render(DOCUMENT)
				.map((r) => r.noteIndex)
		).toEqual([0, 0, 0, 0, 0]);
	});
});

describe('numeric styles', () => {
	it('numbers sources by first appearance and reuses the number', () => {
		const rendered = engineFor('ieee')
			.render(DOCUMENT)
			.map((r) => plain(r.text));

		expect(rendered).toEqual(['[1]', '[2]', '[2]', '[3]', '[1], [4]']);
	});

	it('renumbers when citation order changes', () => {
		const reordered: CitationCluster[] = [
			{ id: 'c1', itemIds: ['tanaka-2021-book'] },
			{ id: 'c2', itemIds: ['smith-2020-a'] }
		];
		const rendered = engineFor('ieee')
			.render(reordered)
			.map((r) => plain(r.text));

		expect(rendered).toEqual(['[1]', '[2]']);
	});
});

describe('bibliography', () => {
	// The defect this guards: makeBibliography() was called without ever telling
	// the engine which works were cited.
	it('contains exactly the cited works and excludes uncited ones', () => {
		const engine = engineFor('apa');
		engine.render(DOCUMENT);
		const bib = engine.bibliography().map(plain);

		expect(bib).toHaveLength(4);
		expect(bib.join('\n')).not.toContain('A source that is never cited');
		expect(bib.join('\n')).not.toContain('Nobody');
	});

	it('carries the disambiguation letters through to the bibliography', () => {
		const engine = engineFor('apa');
		engine.render(DOCUMENT);
		const bib = engine.bibliography().map(plain);

		expect(bib.some((e) => e.includes('Smith, A. (2020a)'))).toBe(true);
		expect(bib.some((e) => e.includes('Smith, A. (2020b)'))).toBe(true);
	});

	it('includes the journal name', () => {
		// Regression guard: CitationItem once typed `container-title` as string[],
		// which makes citeproc silently omit the journal and throws in IEEE.
		const engine = engineFor('apa');
		engine.render(DOCUMENT);

		expect(engine.bibliography().map(plain).join('\n')).toContain('Journal of Coastal Research');
	});

	it('produces a bibliography for every supported style', () => {
		for (const style of [
			'apa',
			'chicago-author-date',
			'chicago-notes-bibliography',
			'harvard-cite-them-right',
			'ieee'
		]) {
			const engine = engineFor(style);
			engine.render(DOCUMENT);

			expect(engine.bibliography(), `${style} bibliography`).toHaveLength(4);
		}
	});
});

describe('style switching', () => {
	it('re-renders the same document differently per style', () => {
		const first = (style: string) => plain(engineFor(style).render(DOCUMENT)[0].text);

		expect(first('apa')).toBe('(Smith, 2020a)');
		expect(first('chicago-author-date')).toBe('(Smith 2020a)');
		expect(first('harvard-cite-them-right')).toBe('(Smith, 2020a)');
		expect(first('ieee')).toBe('[1]');
		expect(first('chicago-notes-bibliography')).toContain('Alice Smith');
	});
});
