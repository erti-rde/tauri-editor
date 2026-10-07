import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { LIMITS, LimitError } from '$lib/guard';
import { sourceFiles, withoutComments } from '$lib/theme/sourceScan';
import { formatOf, readBibliography } from './index';

describe('which files are bibliographies', () => {
	// M1b-9 AC-1: .bib, .ris and CSL-JSON .json.
	it.each([
		['library.bib', 'bibtex'],
		['Library.BIB', 'bibtex'],
		['export.ris', 'ris'],
		['zotero.json', 'csl-json'],
		['notes.txt', null],
		['bib', null]
	])('%s is %s', (name, format) => {
		expect(formatOf(name)).toBe(format);
	});
});

describe('reading one', () => {
	// M1b-9 AC-1
	it('reads each format into CSL items, with no id of the file’s own', async () => {
		const bib = await readBibliography('@book{k, title = {A}}', 'bibtex');
		const ris = await readBibliography('TY  - BOOK\nID  - k\nTI  - A\nER  - ', 'ris');
		const json = await readBibliography('[{"id":"k","type":"book","title":"A"}]', 'csl-json');
		for (const { entries } of [bib, ris, json]) {
			expect(entries).toHaveLength(1);
			expect(entries[0].key).toBe('k');
			expect(entries[0].item).toMatchObject({ type: 'book', title: 'A' });
			expect(entries[0].item).not.toHaveProperty('id');
		}
	});

	// M1b-9 AC-4: nothing can be added without a title.
	it('lists an entry with no title as unreadable, in line order with the rest', async () => {
		const { entries, unreadable } = await readBibliography(
			'@book{a, title = {A}}\n@book{b, author = {X, Y}}\n@book{c, title = {Open',
			'bibtex'
		);
		expect(entries.map((e) => e.key)).toEqual(['a']);
		expect(unreadable).toEqual([
			{ key: 'b', line: 2, reason: 'It has no title.' },
			{ key: 'c', line: 3, reason: 'A brace or quote is never closed.' }
		]);
	});

	// M1b-10 AC-3
	it('refuses a file over the size limit, naming it', async () => {
		const big = 'x'.repeat(LIMITS.bibliographyBytes + 1);
		await expect(readBibliography(big, 'ris')).rejects.toThrow(/at most 20 MB/);
	});

	// M1b-10 AC-3
	it('refuses a file with more entries than one import takes, naming the limit', async () => {
		const many = JSON.stringify(
			Array.from({ length: LIMITS.importEntries + 1 }, () => ({ type: 'book', title: 'A' }))
		);
		await expect(readBibliography(many, 'csl-json')).rejects.toBeInstanceOf(LimitError);
		await expect(readBibliography(many, 'csl-json')).rejects.toThrow(/at most 50,000 sources/);
	});

	// M1b-10 AC-3: one entry over a limit is left out, not the file.
	it('leaves out an entry over a limit and says why', async () => {
		const people = Array.from({ length: LIMITS.names + 1 }, (_, i) => ({ family: `P${i}` }));
		const { entries, unreadable } = await readBibliography(
			JSON.stringify([
				{ type: 'book', title: 'Crowded', author: people },
				{ type: 'book', title: 'Fine' }
			]),
			'csl-json'
		);
		expect(entries.map((e) => e.item.title)).toEqual(['Fine']);
		expect(unreadable[0].reason).toMatch(/at most 10,000 people/);
	});

	it('says a file it can’t read at all', async () => {
		const { entries, unreadable } = await readBibliography('{', 'csl-json');
		expect(entries).toEqual([]);
		expect(unreadable[0].reason).toBe('The file isn’t valid JSON.');
	});
});

describe('the BibTeX parser', () => {
	// M1b-9 AC-5: loaded on the first import, not at startup. Only bibtex.ts
	// imports it, and only index.ts imports bibtex.ts, with import().
	it('is imported by nothing but the module that is loaded on demand', () => {
		const statically = /\b(?:import|export)\s[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;
		const offenders = sourceFiles('src').flatMap((file) =>
			[...withoutComments(readFileSync(file, 'utf8')).matchAll(statically)]
				.map((m) => m[1])
				.filter((from) =>
					from === '@retorquere/bibtex-parser'
						? !file.endsWith('src/lib/import/bibtex.ts')
						: /(^|\/)import\/bibtex$|^\.\/bibtex$/.test(from)
				)
				.map((from) => `${file} → ${from}`)
		);
		expect(offenders).toEqual([]);
		expect(readFileSync('src/lib/import/index.ts', 'utf8')).toMatch(/await import\('\.\/bibtex'\)/);
	});
});

describe('ten thousand entries', () => {
	// M1b-9 AC-6: reading is a small part of the 30 s budget.
	it('are read in a few seconds', async () => {
		const bib = Array.from(
			{ length: 10_000 },
			(_, i) =>
				`@article{k${i},\n  title = {A Study of {DNA} Number ${i}},\n  author = {Smith, John and Doe, Jane},\n  journal = {Journal},\n  year = {2020},\n  doi = {10.5555/${i}}\n}`
		).join('\n');
		const started = performance.now();
		const { entries } = await readBibliography(bib, 'bibtex');
		expect(entries).toHaveLength(10_000);
		expect(performance.now() - started).toBeLessThan(10_000);
	}, 20_000);
});
