// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { canonical, canonicalIds } from './aliases';
import { CitationEngine } from './engine';
import { MISSING_SOURCE_LABEL, renderDocumentCitations, type CitationSite } from './document';
import { snapshotSources } from '$lib/manuscript/format';
import type { CitationItem } from '$lib/stores/citationStore';
import type { CslItem } from '$lib/guard';

/**
 * One id per work (ADR 003, M1b-3), on the webview's side: the shared fixture,
 * and the two boundaries that are pure — rendering and the envelope. The store,
 * the search panel and the Notes panel are covered beside their own code.
 */

const root = process.cwd();
const fixture = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/aliases.json'), 'utf8')) as {
	aliases: Record<string, string>;
	resolve: { why: string; id: string; canonical: string }[];
	sets: { why: string; ids: string[]; canonical: string[] }[];
};

// M1b-3 AC-2
describe('the shared alias fixture', () => {
	for (const c of fixture.resolve) {
		it(`resolves as Rust does: ${c.why}`, () => {
			expect(canonical(fixture.aliases, c.id)).toBe(c.canonical);
		});
	}

	for (const c of fixture.sets) {
		it(`resolves a set as Rust does: ${c.why}`, () => {
			expect(canonicalIds(fixture.aliases, c.ids)).toEqual(c.canonical);
		});
	}

	it('never treats a property every object has as an alias', () => {
		expect(canonical(fixture.aliases, 'constructor')).toBe('constructor');
		expect(canonical(fixture.aliases, '__proto__')).toBe('__proto__');
	});
});

const CSL = resolve(root, 'tests/fixtures/csl');
const read = (p: string) => readFileSync(resolve(CSL, p), 'utf8');
const sources = JSON.parse(read('sources.json')) as Record<string, CitationItem>;
const plain = (html: string) =>
	html
		.replace(/<[^>]+>/g, '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/\s+/g, ' ')
		.trim();

const BOOK = 'erti:6f1c3a52-8d0e-4c1b-9a7e-2b5d4f3e1a01';
const PDF = 'a1'.repeat(32);
const book = { ...sources['tanaka-2021-book'], id: BOOK };
const aliases = { [PDF]: BOOK };

/** Rendered as the store renders: canonical rows only, ids resolved. */
function render(sites: CitationSite[], resolveId?: (id: string) => string) {
	const library = { [BOOK]: book };
	const engine = new CitationEngine({
		styleXml: read('styles/apa.csl'),
		localeXml: read('locales/locales-en-US.xml'),
		sources: library
	});
	const out = renderDocumentCitations(sites, engine, new Set(Object.keys(library)), resolveId);
	return {
		labels: out.sites.map((s) => plain(s.label)),
		bibliography: out.bibliography.map(plain)
	};
}

// M1b-3 AC-1: citation rendering
describe('rendering citations by work', () => {
	const resolveId = (id: string) => canonical(aliases, id);

	it('renders a citation of an attached PDF as the work', () => {
		const byWork = render([{ pos: 0, itemIds: [BOOK] }], resolveId);
		const byFile = render([{ pos: 0, itemIds: [PDF] }], resolveId);
		expect(byFile).toEqual(byWork);
		expect(byFile.labels[0]).not.toBe(MISSING_SOURCE_LABEL);
	});

	it('cites a work once when one citation names it and its PDF', () => {
		const once = render([{ pos: 0, itemIds: [BOOK] }], resolveId);
		const both = render([{ pos: 0, itemIds: [BOOK, PDF] }], resolveId);
		expect(both).toEqual(once);
	});

	it('without resolving, the PDF renders as removed: why every boundary needs it', () => {
		expect(render([{ pos: 0, itemIds: [PDF] }]).labels[0]).toBe(MISSING_SOURCE_LABEL);
	});
});

// M1b-3 AC-1: the envelope
describe('the sources a manuscript carries', () => {
	it('looks a cited alias up by its work, and files it under the id cited', () => {
		const library = { [BOOK]: book };
		const carried = { [PDF]: { id: PDF, type: 'book', title: 'An old snapshot' } as CslItem };

		const saved = snapshotSources([PDF], library, carried, (id) => canonical(aliases, id));

		// The library's copy of the work, not the snapshot the file came with,
		// under the id a co-author's Erti will look for.
		expect(Object.keys(saved)).toEqual([PDF]);
		expect(saved[PDF].title).toBe(book.title);
		expect(saved[PDF].id).toBe(PDF);
	});
});
