import { describe, expect, it } from 'vitest';

import { citationKey, escapeBibtex, toBibliography } from './bibtex';
import type { CitationItem } from '$lib/stores/citationStore';

const smith: CitationItem = {
	id: 'sha-smith',
	type: 'article-journal',
	title: 'Coastal Erosion under Rising Sea Levels',
	author: [{ family: 'Smith', given: 'Alice' }],
	issued: { 'date-parts': [[2020]] },
	'container-title': 'Journal of Coastal Research',
	volume: '36',
	issue: '2',
	page: '101-118',
	DOI: '10.1000/coastal'
};

describe('citation keys', () => {
	it('reads the way a researcher writes one by hand', () => {
		// The key appears in the .tex, so a co-author editing it sees
		// \cite{smith2020coastal}, not a hash.
		expect(citationKey(smith)).toBe('smith2020coastal');
	});

	it('skips a leading article in the title', () => {
		expect(citationKey({ ...smith, title: 'The Coastal Erosion of Everything' })).toBe(
			'smith2020coastal'
		);
	});

	it('keeps a name with diacritics readable', () => {
		// Stripping the letters rather than the accents would give "mller".
		expect(citationKey({ ...smith, author: [{ family: 'Müller', given: 'Jan' }] })).toBe(
			'muller2020coastal'
		);
	});

	it('disambiguates a collision the way a person would', () => {
		const taken = new Set(['smith2020coastal']);

		expect(citationKey(smith, taken)).toBe('smith2020coastalb');
	});

	it('still produces a key with no author, year or title', () => {
		const bare: CitationItem = { id: 'abc123def456', type: 'misc' };

		expect(citationKey(bare)).toMatch(/^source/);
	});
});

describe('escaping a field', () => {
	it('escapes what BibTeX reads structurally', () => {
		expect(escapeBibtex('Cost & Benefit')).toBe('Cost \\& Benefit');
		expect(escapeBibtex('50%')).toBe('50\\%');
		expect(escapeBibtex('{braced}')).toBe('\\{braced\\}');
	});

	it('does not re-escape its own output', () => {
		expect(escapeBibtex('\\')).toBe('\\textbackslash{}');
	});
});

describe('building a .bib', () => {
	const sources = { 'sha-smith': smith, 'sha-unused': { ...smith, id: 'sha-unused' } };

	it('includes only the sources the manuscript cites', () => {
		// A .bib of the whole library lists papers the manuscript never mentions,
		// and some journals check.
		const { bibtex } = toBibliography(sources, ['sha-smith']);

		expect(bibtex.match(/@article/g)).toHaveLength(1);
	});

	it('maps the CSL type to a BibTeX one', () => {
		expect(toBibliography(sources, ['sha-smith']).bibtex).toContain('@article{');
		expect(toBibliography({ b: { ...smith, type: 'book' } }, ['b']).bibtex).toContain('@book{');
		expect(toBibliography({ c: { ...smith, type: 'paper-conference' } }, ['c']).bibtex).toContain(
			'@inproceedings{'
		);
	});

	it('writes the fields a journal needs', () => {
		const { bibtex } = toBibliography(sources, ['sha-smith']);

		expect(bibtex).toContain('author = {Smith, Alice}');
		expect(bibtex).toContain('journal = {{Journal of Coastal Research}}');
		expect(bibtex).toContain('year = {2020}');
		expect(bibtex).toContain('doi = {10.1000/coastal}');
	});

	it('protects the title from BibTeX re-casing it', () => {
		// plain and most journal styles lowercase a title unless it is braced, so
		// "Coastal Erosion" prints as "Coastal erosion" and "DNA" as "dna".
		// Researchers brace titles by hand for exactly this reason.
		const { bibtex } = toBibliography(sources, ['sha-smith']);

		expect(bibtex).toContain('title = {{Coastal Erosion under Rising Sea Levels}}');
		expect(bibtex).toContain('journal = {{Journal of Coastal Research}}');
	});

	it('does not brace a field where case carries no meaning', () => {
		const { bibtex } = toBibliography(sources, ['sha-smith']);

		expect(bibtex).toContain('year = {2020}');
		expect(bibtex).not.toContain('year = {{2020}}');
	});

	it('writes a page range with an en-dash as BibTeX expects', () => {
		expect(toBibliography(sources, ['sha-smith']).bibtex).toContain('pages = {101--118}');
	});

	it('joins authors the way BibTeX parses them', () => {
		// "Family, Given" so a two-word surname is not read as a middle name.
		const two = {
			...smith,
			author: [
				{ family: 'Okafor', given: 'Chidi' },
				{ family: 'van der Berg', given: 'Marit' }
			]
		};

		expect(toBibliography({ x: two }, ['x']).bibtex).toContain(
			'author = {Okafor, Chidi and van der Berg, Marit}'
		);
	});

	it('returns the keys the .tex must cite by', () => {
		const { keys } = toBibliography(sources, ['sha-smith']);

		expect(keys['sha-smith']).toBe('smith2020coastal');
	});

	it('gives two different papers two different keys', () => {
		const other = { ...smith, id: 'sha-2', title: 'Coastal Erosion Revisited' };
		const { keys } = toBibliography({ a: smith, b: other }, ['a', 'b']);

		expect(keys['a']).not.toBe(keys['b']);
	});

	it('produces an identical file for an unchanged manuscript', () => {
		// Re-exporting must not create a spurious diff for a co-author.
		const first = toBibliography(sources, ['sha-smith', 'sha-unused']).bibtex;
		const second = toBibliography(sources, ['sha-unused', 'sha-smith']).bibtex;

		expect(first).toBe(second);
	});

	it('skips a cited id with no source behind it', () => {
		expect(toBibliography(sources, ['gone']).bibtex).toBe('');
	});

	it('is empty for a manuscript that cites nothing', () => {
		expect(toBibliography(sources, [])).toEqual({ bibtex: '', keys: {} });
	});
});
