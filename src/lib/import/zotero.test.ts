import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LIMITS } from '$lib/guard';
import type { ZoteroCreator, ZoteroItem } from '$lib/ipc';
import type { OriginalZoteroSchema } from '$lib/metadata-explorer/adapterCslZotero';
import { readZoteroItems, zoteroDate, zoteroToCsl } from './zotero';

const schema: OriginalZoteroSchema = JSON.parse(
	readFileSync(resolve('src-tauri/resources/csl/schema.json'), 'utf8')
);
const maps = schema.csl;

const person = (last: string, first: string, creator_type = 'author'): ZoteroCreator => ({
	creator_type,
	first_name: first,
	last_name: last,
	single: false
});

function item(
	item_type: string,
	fields: Record<string, string | [string, string]>,
	creators: ZoteroCreator[] = []
): ZoteroItem {
	return {
		library: 'user',
		key: 'ABCD2345',
		item_type,
		fields: Object.entries(fields).map(([name, v]) =>
			Array.isArray(v) ? { name, base: v[0], value: v[1] } : { name, base: null, value: v }
		),
		creators,
		pdfs: []
	};
}

// M1b-11 AC-9: the main types, mapped as Zotero's own CSL export maps them.
describe('zoteroToCsl', () => {
	it.each([
		[
			'journal article',
			item(
				'journalArticle',
				{
					title: 'Trust in institutions',
					publicationTitle: 'Journal of Trust',
					volume: '12',
					issue: '3',
					pages: '1-20',
					DOI: '10.5555/trust',
					date: '2020-03-00 March 2020'
				},
				[person('Lovelace', 'Ada'), person('Turing', 'Alan')]
			),
			{
				type: 'article-journal',
				title: 'Trust in institutions',
				'container-title': 'Journal of Trust',
				volume: '12',
				issue: '3',
				page: '1-20',
				DOI: '10.5555/trust',
				issued: { 'date-parts': [[2020, 3]] },
				author: [
					{ family: 'Lovelace', given: 'Ada' },
					{ family: 'Turing', given: 'Alan' }
				]
			}
		],
		[
			'book',
			item(
				'book',
				{ title: 'On computable numbers', publisher: 'OUP', place: 'Oxford', ISBN: '978-0-19' },
				[person('Turing', 'Alan', 'editor')]
			),
			{
				type: 'book',
				title: 'On computable numbers',
				publisher: 'OUP',
				// Zotero's map puts a place in both, as its own export does.
				'publisher-place': 'Oxford',
				'event-place': 'Oxford',
				ISBN: '978-0-19',
				editor: [{ family: 'Turing', given: 'Alan' }]
			}
		],
		[
			'book section, its book title standing for the base field',
			item(
				'bookSection',
				{ title: 'A chapter', bookTitle: ['publicationTitle', 'The Handbook'], pages: '5-9' },
				[person('Hopper', 'Grace'), person('Turing', 'Alan', 'bookAuthor')]
			),
			{
				type: 'chapter',
				title: 'A chapter',
				'container-title': 'The Handbook',
				page: '5-9',
				author: [{ family: 'Hopper', given: 'Grace' }],
				'container-author': [{ family: 'Turing', given: 'Alan' }]
			}
		],
		[
			'thesis',
			item('thesis', {
				title: 'A thesis',
				thesisType: ['type', 'PhD thesis'],
				university: ['publisher', 'University of Tbilisi']
			}),
			{
				type: 'thesis',
				title: 'A thesis',
				genre: 'PhD thesis',
				publisher: 'University of Tbilisi'
			}
		],
		[
			'report',
			item('report', {
				title: 'Annual report',
				reportNumber: ['number', '7'],
				institution: ['publisher', 'WHO']
			}),
			{ type: 'report', title: 'Annual report', number: '7', publisher: 'WHO' }
		],
		[
			'web page',
			item('webpage', {
				title: 'A page',
				websiteTitle: ['publicationTitle', 'A site'],
				url: 'https://example.org',
				accessDate: '2024-05-06 10:11:12'
			}),
			{
				type: 'webpage',
				title: 'A page',
				'container-title': 'A site',
				URL: 'https://example.org',
				accessed: { 'date-parts': [[2024, 5, 6]] }
			}
		],
		[
			'a PDF on its own',
			item('attachment', { title: 'Scanned chapter' }),
			{ type: 'document', title: 'Scanned chapter' }
		]
	])('maps a %s', (_, zotero, csl) => {
		expect(zoteroToCsl(zotero, maps)).toEqual(csl);
	});

	// M1b-11 AC-9: a name Zotero keeps whole is a literal.
	it('keeps a one-field name whole', () => {
		const who: ZoteroCreator = {
			creator_type: 'author',
			first_name: '',
			last_name: 'World Health Organization',
			single: true
		};
		expect(zoteroToCsl(item('report', { title: 'R' }, [who]), maps).author).toEqual([
			{ literal: 'World Health Organization' }
		]);
	});

	it('leaves out empty fields', () => {
		expect(zoteroToCsl(item('book', { title: 'T', publisher: '  ' }), maps)).toEqual({
			type: 'book',
			title: 'T'
		});
	});
});

// M1b-11 AC-9
describe('zoteroDate', () => {
	it.each([
		['2019-03-00 March 2019', { 'date-parts': [[2019, 3]] }],
		['2019-03-14 14 March 2019', { 'date-parts': [[2019, 3, 14]] }],
		['1936-00-00 1936', { 'date-parts': [[1936]] }],
		['0000-00-00 Spring term', { literal: 'Spring term' }],
		['2024-05-06 10:11:12', { 'date-parts': [[2024, 5, 6]] }],
		['circa 1900', { literal: 'circa 1900' }],
		['', undefined],
		['0000-00-00', undefined]
	])('reads %j', (stored, date) => {
		expect(zoteroDate(stored)).toEqual(date);
	});
});

describe('readZoteroItems', () => {
	it('guards each paper and keeps where it came from', () => {
		const paper = { ...item('book', { title: 'T' }), library: 'group:4242', key: 'PAPERBB2' };
		paper.pdfs = [{ key: 'ATTACHA2', file_name: 'a.pdf', reason: null }];
		const { entries, unreadable } = readZoteroItems([paper], maps);
		expect(unreadable).toEqual([]);
		expect(entries).toEqual([
			{
				key: 'PAPERBB2',
				line: null,
				item: { type: 'book', title: 'T' },
				files: [],
				library: 'group:4242',
				zoteroKey: 'PAPERBB2',
				pdfs: paper.pdfs
			}
		]);
	});

	// M1b-10: an import from Zotero passes the same limits as a file does.
	it('says which paper is over a limit and reads the rest', () => {
		const crowd = Array.from({ length: LIMITS.names + 1 }, (_, i) => person(`P${i}`, 'X'));
		const big = { ...item('book', { title: 'Big' }, crowd), key: 'BIGBOOK2' };
		const { entries, unreadable } = readZoteroItems([big, item('book', { title: 'T' })], maps);
		expect(entries.map((e) => e.item.title)).toEqual(['T']);
		expect(unreadable[0].key).toBe('BIGBOOK2');
	});
});
