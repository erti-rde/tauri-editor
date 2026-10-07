import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseRis, TYPES } from './ris';

const fixture = (name: string) => readFileSync(resolve('src/lib/import/fixtures', name), 'utf8');

const read = (name: string) => {
	const { entries } = parseRis(fixture(name));
	return new Map(entries.map((e) => [e.key, e]));
};

/*
 * M1b-9 AC-3: RIS's own table. Zotero writes T2, DA and file:// links; EndNote
 * writes T1, JF, Y1, its own internal-pdf:// store and one page field.
 */
describe.each<[string, string, string, unknown]>([
	['zotero.ris', 'entry 1', 'type', 'article-journal'],
	['zotero.ris', 'entry 1', 'title', 'Justice as Fairness'],
	['zotero.ris', 'entry 1', 'container-title', 'The Philosophical Review'],
	['zotero.ris', 'entry 1', 'author', [{ family: 'Rawls', given: 'John' }]],
	['zotero.ris', 'entry 1', 'issued', { 'date-parts': [[1958, 4]] }],
	['zotero.ris', 'entry 1', 'accessed', { 'date-parts': [[2024, 1, 5]] }],
	['zotero.ris', 'entry 1', 'page', '164-194'],
	['zotero.ris', 'entry 1', 'volume', '67'],
	['zotero.ris', 'entry 1', 'issue', '2'],
	['zotero.ris', 'entry 1', 'DOI', '10.2307/2182612'],
	['zotero.ris', 'entry 1', 'ISSN', '0031-8108'],
	['zotero.ris', 'entry 1', 'URL', 'https://www.jstor.org/stable/2182612'],
	['zotero.ris', 'entry 1', 'keyword', 'justice, contract'],
	['zotero.ris', 'entry 2', 'type', 'chapter'],
	['zotero.ris', 'entry 2', 'container-title', 'The Routledge Handbook of Epistemic Injustice'],
	[
		'zotero.ris',
		'entry 2',
		'editor',
		[
			{ family: 'Kidd', given: 'Ian James' },
			{ family: 'Medina', given: 'José' },
			{ family: 'Pohlhaus', given: 'Gaile', suffix: 'Jr.' }
		]
	],
	['zotero.ris', 'entry 2', 'publisher-place', 'London'],
	['zotero.ris', 'entry 2', 'ISBN', '978-1-138-82825-4'],
	['zotero.ris', 'entry 3', 'type', 'book'],
	['zotero.ris', 'entry 3', 'collection-title', 'Charles R. Walgreen Foundation Lectures'],
	['zotero.ris', 'entry 3', 'container-title', undefined],
	['zotero.ris', 'entry 3', 'note', 'Second edition 1998'],
	['zotero.ris', 'entry 4', 'type', 'webpage'],
	['zotero.ris', 'entry 4', 'author', [{ literal: 'World Health Organization' }]],
	['zotero.ris', 'entry 4', 'issued', { 'date-parts': [[2023, 9, 19]] }],
	['endnote.ris', '17', 'title', 'Reading Kant Late'],
	['endnote.ris', '17', 'container-title', 'Mind'],
	['endnote.ris', '17', 'issued', { 'date-parts': [[2019, 10, 1]] }],
	['endnote.ris', '17', 'page', '1021-1048'],
	['endnote.ris', '17', 'abstract', 'We read Kant late, and closely.'],
	['endnote.ris', '18', 'type', 'thesis'],
	['endnote.ris', '18', 'genre', 'PhD thesis'],
	['endnote.ris', '18', 'publisher', 'University of Edinburgh'],
	['endnote.ris', '20', 'issued', { literal: 'in press' }]
])('%s › %s', (file, key, field, expected) => {
	// M1b-9 AC-3
	it(`reads ${field}`, () => {
		const entry = read(file).get(key);
		expect(entry, `${key} is read`).toBeDefined();
		expect(entry?.item[field]).toEqual(expected);
	});
});

describe('RIS types', () => {
	// M1b-9 AC-3
	it.each([
		['JOUR', 'article-journal'],
		['BOOK', 'book'],
		['CHAP', 'chapter'],
		['CONF', 'paper-conference'],
		['THES', 'thesis'],
		['RPRT', 'report'],
		['ELEC', 'webpage'],
		['NEWS', 'article-newspaper'],
		['DATA', 'dataset'],
		['GEN', 'document']
	])('%s is a CSL %s', (ris, csl) => {
		expect(TYPES[ris]).toBe(csl);
		expect(parseRis(`TY  - ${ris}\nTI  - A\nER  - `).entries[0].item.type).toBe(csl);
	});

	it('an unknown type is a document', () => {
		expect(parseRis('TY  - ZZZZ\nTI  - A\nER  - ').entries[0].item.type).toBe('document');
	});
});

describe('files', () => {
	// M1b-9 AC-3: Zotero links its PDF; EndNote's own store isn't a path anyone can open.
	it('a file:// link is the path it names; internal-pdf:// is nothing', () => {
		expect(read('zotero.ris').get('entry 1')?.files).toEqual([
			'/Users/ana/Zotero/storage/ABCD1234/Rawls - 1958 - Justice as Fairness.pdf'
		]);
		expect(read('endnote.ris').get('17')?.files).toEqual([]);
	});

	it('a Windows file:// link is a Windows path', () => {
		const { entries } = parseRis(
			'TY  - GEN\nTI  - A\nL1  - file:///C:/Users/ana/a%20b.pdf\nER  - '
		);
		expect(entries[0].files).toEqual(['C:/Users/ana/a b.pdf']);
	});
});

describe('entries that can’t be read', () => {
	// M1b-9 AC-4: by key where there is one, and the line.
	it('are said with the line they start on, and the rest are read', () => {
		const { entries, unreadable } = parseRis(fixture('endnote.ris'));
		expect(unreadable).toEqual([
			{ key: null, line: 28, reason: 'A field outside any entry (no TY before it).' },
			{ key: '19', line: 29, reason: 'It has no end (ER).' }
		]);
		expect(entries.map((e) => [e.key, e.line])).toEqual([
			['17', 1],
			['18', 19],
			['20', 34]
		]);
	});

	it('an entry still open at the end of the file', () => {
		expect(parseRis('TY  - JOUR\nTI  - Cut off').unreadable).toEqual([
			{ key: null, line: 1, reason: 'It has no end (ER).' }
		]);
	});

	it('Windows line endings and a byte-order mark are read', () => {
		const { entries } = parseRis('\uFEFFTY  - BOOK\r\nTI  - A\r\nER  - \r\n');
		expect(entries[0].item).toMatchObject({ type: 'book', title: 'A' });
	});
});
