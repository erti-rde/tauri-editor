// @vitest-environment node
// SPIKE (M1b-1, ADR 003): do aliases hold at the rendering boundary? Throwaway.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { CitationEngine } from './engine';
import { MISSING_SOURCE_LABEL, renderDocumentCitations, type CitationSite } from './document';
import type { CitationItem } from '$lib/stores/citationStore';

const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/csl', import.meta.url));
const read = (p: string) => readFileSync(resolve(FIXTURES, p), 'utf8');
const fixtures = JSON.parse(read('sources.json')) as Record<string, CitationItem>;
const enUS = read('locales/locales-en-US.xml');
const apa = read('styles/apa.csl');
const plain = (html: string) =>
	html
		.replace(/<[^>]+>/g, '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/\s+/g, ' ')
		.trim();

/** The prototype TS resolver: one lookup, since chains are refused on write. */
const canonical = (aliases: Record<string, string>) => (id: string) => aliases[id] ?? id;

/**
 * What the editor would do: resolve every cited id, then render. Sources are
 * the canonical rows only (CSL on an alias row is ignored, ADR 003).
 */
function render(
	sites: CitationSite[],
	sources: Record<string, CitationItem>,
	aliases: Record<string, string> = {}
) {
	const resolveId = canonical(aliases);
	const resolved = sites.map((s) => ({ ...s, itemIds: [...new Set(s.itemIds.map(resolveId))] }));
	const engine = new CitationEngine({ styleXml: apa, localeXml: enUS, sources });
	const out = renderDocumentCitations(resolved, engine, new Set(Object.keys(sources)));
	return {
		labels: out.sites.map((s) => plain(s.label)),
		bibliography: out.bibliography.map(plain)
	};
}

const BOOK = 'erti:7f8e1c2a-0000-4000-8000-000000000001';
const FILE = 'a'.repeat(64);
const book = { ...fixtures['tanaka-2021-book'], id: BOOK };

describe('M1b-1 spike: aliases hold where citations render', () => {
	// AC-1
	it('a cited no-file source renders the same after its PDF is attached', () => {
		const chapter = [{ pos: 0, itemIds: [BOOK] }];
		const before = render(chapter, { [BOOK]: book });

		// Attached: the file's row exists but has no CSL of its own yet, so it
		// isn't citable and isn't in the map; the alias says it's the book.
		const after = render(chapter, { [BOOK]: book }, { [FILE]: BOOK });
		expect(after).toEqual(before);
		expect(after.labels[0]).not.toBe(MISSING_SOURCE_LABEL);

		// A citation inserted from the PDF before the alias existed renders as
		// the book too.
		const viaFile = render([{ pos: 0, itemIds: [FILE] }], { [BOOK]: book }, { [FILE]: BOOK });
		expect(viaFile).toEqual(before);
	});

	// AC-3
	it('merging two cited ids keeps both manuscripts rendering the same work', () => {
		const PREPRINT = 'b'.repeat(64);
		const BY_HAND = 'erti:7f8e1c2a-0000-4000-8000-000000000002';
		const paper = fixtures['okafor-2019'];
		const sources = {
			[PREPRINT]: { ...paper, id: PREPRINT },
			[BY_HAND]: { ...paper, id: BY_HAND }
		};
		const chapter1 = [{ pos: 0, itemIds: [PREPRINT] }];
		const chapter2 = [{ pos: 0, itemIds: [BY_HAND] }];
		const both = [
			{ pos: 0, itemIds: [PREPRINT] },
			{ pos: 10, itemIds: [BY_HAND] }
		];

		// Before the merge, citeproc sees two works with the same author and year
		// and disambiguates them: the duplicate the merge is for.
		expect(render(both, sources).bibliography).toHaveLength(2);
		expect(render(both, sources).labels[0]).toMatch(/2019a/);

		// Merged: only the canonical row is a source; the alias row's CSL is ignored.
		const merged = { [PREPRINT]: sources[PREPRINT] };
		const aliases = { [BY_HAND]: PREPRINT };
		const one = render(chapter1, merged, aliases);
		const two = render(chapter2, merged, aliases);
		expect(two).toEqual(one);
		expect(one.labels[0]).not.toBe(MISSING_SOURCE_LABEL);

		// And a manuscript citing both now cites one work once.
		const together = render(both, merged, aliases);
		expect(together.bibliography).toHaveLength(1);
		expect(together.labels).toEqual([one.labels[0], one.labels[0]]);
	});

	it('without the resolver, the merged id renders as removed: every boundary needs it', () => {
		const PREPRINT = 'b'.repeat(64);
		const BY_HAND = 'erti:7f8e1c2a-0000-4000-8000-000000000002';
		const merged = { [PREPRINT]: { ...fixtures['okafor-2019'], id: PREPRINT } };
		expect(render([{ pos: 0, itemIds: [BY_HAND] }], merged).labels[0]).toBe(MISSING_SOURCE_LABEL);
	});
});
