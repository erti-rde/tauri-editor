// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { CitationEngine } from './engine';
import {
	MISSING_SOURCE_LABEL,
	parseCitationIds,
	renderDocumentCitations,
	type CitationSite
} from './document';
import type { CitationItem } from '$lib/stores/citationStore';

// Resolved from this module, not the working directory, so the suite does not
// depend on where it was started from.
const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/csl', import.meta.url));
const read = (p: string) => readFileSync(resolve(FIXTURES, p), 'utf8');

const sources = JSON.parse(read('sources.json')) as Record<string, CitationItem>;
const enUS = read('locales/locales-en-US.xml');
const apa = read('styles/apa.csl');
const chicagoNotes = read('styles/chicago-notes-bibliography.csl');

/** citeproc emits HTML; compare against readable text. */
const plain = (html: string) =>
	html
		.replace(/<[^>]+>/g, '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/\s+/g, ' ')
		.trim();

/**
 * These assert the document-level behaviour the editor could not previously
 * produce: the same citation rendered differently depending on what else the
 * document cites, and on where.
 */

function engineFor(styleXml: string) {
	return new CitationEngine({ styleXml, localeXml: enUS, sources });
}

const known = new Set(Object.keys(sources));

const sitesOf = (...ids: string[][]): CitationSite[] =>
	ids.map((itemIds, i) => ({ pos: i * 10, itemIds }));

describe('rendering a document', () => {
	it('disambiguates two same-author same-year sources', () => {
		// Rendered in isolation, both are "(Smith, 2020)" and the reader cannot
		// tell which paper is meant. This is the defect that made every citation
		// feature untrustworthy.
		const { sites } = renderDocumentCitations(
			sitesOf(['smith-2020-a'], ['smith-2020-b']),
			engineFor(apa),
			known
		);

		expect(plain(sites[0].label)).toContain('2020a');
		expect(plain(sites[1].label)).toContain('2020b');
	});

	it('numbers notes in document order', () => {
		const { sites } = renderDocumentCitations(
			sitesOf(['smith-2020-a'], ['okafor-2019'], ['smith-2020-b']),
			engineFor(chicagoNotes),
			known
		);

		expect(sites.map((s) => s.noteIndex)).toEqual([1, 2, 3]);
	});

	it('shortens a repeated citation in a note style', () => {
		const { sites } = renderDocumentCitations(
			sitesOf(['smith-2020-a'], ['okafor-2019'], ['smith-2020-a']),
			engineFor(chicagoNotes),
			known
		);

		// The first is given in full; the third refers back to it.
		expect(plain(sites[2].label).length).toBeLessThan(plain(sites[0].label).length);
	});

	it('builds a bibliography of exactly the cited works', () => {
		const { bibliography } = renderDocumentCitations(
			sitesOf(['okafor-2019']),
			engineFor(apa),
			known
		);

		expect(bibliography).toHaveLength(1);
		expect(plain(bibliography[0])).toContain('Okafor');
	});

	it('returns nothing for a document with no citations', () => {
		const { sites, bibliography } = renderDocumentCitations([], engineFor(apa), known);

		expect(sites).toEqual([]);
		expect(bibliography).toEqual([]);
	});
});

describe('a source that no longer exists', () => {
	it('does not blank the rest of the document', () => {
		// Handing citeproc an unresolvable id throws inside the processor, which
		// would lose every citation in the manuscript over one removed paper.
		const { sites } = renderDocumentCitations(
			sitesOf(['smith-2020-a'], ['deleted'], ['okafor-2019']),
			engineFor(apa),
			known
		);

		expect(plain(sites[0].label)).toContain('Smith');
		expect(sites[1].label).toBe(MISSING_SOURCE_LABEL);
		expect(plain(sites[2].label)).toContain('Okafor');
	});

	it('is reported so the editor can flag it', () => {
		const { sites, missingIds } = renderDocumentCitations(
			sitesOf(['deleted']),
			engineFor(apa),
			known
		);

		expect(missingIds).toEqual(['deleted']);
		expect(sites[0].missingIds).toEqual(['deleted']);
	});

	it('keeps the surviving works in a partly-missing cluster', () => {
		const { sites } = renderDocumentCitations(
			sitesOf(['smith-2020-a', 'deleted']),
			engineFor(apa),
			known
		);

		expect(plain(sites[0].label)).toContain('Smith');
		expect(sites[0].missingIds).toEqual(['deleted']);
	});

	it('does not consume a note number for an empty cluster', () => {
		// An empty citationItems array still takes a note number from citeproc, so
		// every note after it would be off by one.
		const { sites } = renderDocumentCitations(
			sitesOf(['smith-2020-a'], ['deleted'], ['okafor-2019']),
			engineFor(chicagoNotes),
			known
		);

		expect(sites[0].noteIndex).toBe(1);
		expect(sites[2].noteIndex).toBe(2);
	});

	it('leaves the bibliography out of it', () => {
		const { bibliography } = renderDocumentCitations(
			sitesOf(['okafor-2019'], ['deleted']),
			engineFor(apa),
			known
		);

		expect(bibliography).toHaveLength(1);
	});
});

describe('reading a citation node', () => {
	it('reads the array a citation point stores', () => {
		expect(parseCitationIds(JSON.stringify(['a', 'b']))).toEqual(['a', 'b']);
	});

	it('reads a bare id from an older document', () => {
		expect(parseCitationIds('sha256-value')).toEqual(['sha256-value']);
		expect(parseCitationIds(JSON.stringify('quoted'))).toEqual(['quoted']);
	});

	it('keeps a bare id that happens to be valid JSON', () => {
		// An all-digit id parses as a number, and so does `1e5`. Discarding those
		// rendered the citation as a removed source.
		expect(parseCitationIds('12345')).toEqual(['12345']);
		expect(parseCitationIds('1e5')).toEqual(['1e5']);
		expect(parseCitationIds('1')).toEqual(['1']);
		expect(parseCitationIds('true')).toEqual(['true']);
	});

	it('yields nothing rather than throwing on a broken node', () => {
		// One malformed node must not stop the document rendering.
		expect(parseCitationIds(null)).toEqual([]);
		expect(parseCitationIds('')).toEqual([]);
		expect(parseCitationIds(JSON.stringify({ id: 'x' }))).toEqual([]);
		expect(parseCitationIds(JSON.stringify([1, 'a', null]))).toEqual(['a']);
	});
});
