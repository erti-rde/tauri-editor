import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
	augment,
	augmentSchema,
	type AugmentedZoteroItemType,
	type OriginalZoteroSchema
} from './adapterCslZotero';
import { dateToText, fromForm, textToDate, toForm, type CslItem } from './cslForm';

const schemaText = readFileSync(resolve('src-tauri/resources/csl/schema.json'), 'utf8');
const schema: OriginalZoteroSchema = JSON.parse(schemaText);
const augmented = augment(schema);

vi.mock('@tauri-apps/plugin-fs', () => ({
	BaseDirectory: { Resource: 11 },
	readTextFile: vi.fn(async () => schemaText)
}));

const typeNamed = (name: string) => augmented.itemTypes.find((t) => t.itemType === name)!;
const fieldIn = (type: string, field: string) =>
	typeNamed(type).fields.find((f) => f.field === field)!;

/** Types the form can show: those with a CSL type to render as. */
const mapped = augmented.itemTypes.filter((t) => t.cslType);

/**
 * A CSL item with every variable the form for `type` shows, filled in.
 *
 * Values are keyed by CSL variable rather than by Zotero field, because two of
 * a type's fields can name the same variable, and they must then agree.
 */
function filled(type: AugmentedZoteroItemType): CslItem {
	const item: CslItem = { type: type.cslType };
	for (const field of type.fields) {
		if (!field.cslField) continue;
		item[field.cslField] =
			field.inputType === 'date'
				? { 'date-parts': [[2017, 6, 12]] }
				: field.inputType === 'number'
					? '12'
					: `${field.cslField} of a ${type.itemType}`;
	}
	for (const role of type.creatorTypes) {
		if (!role.cslVariable) continue;
		item[role.cslVariable] = [
			{ family: 'Vaswani', given: 'Ashish' },
			{ literal: `The ${role.creatorType} Collective` }
		];
	}
	return item;
}

describe('the schema, augmented', () => {
	it('reads the bundled schema from the Resource directory', async () => {
		const { readTextFile } = await import('@tauri-apps/plugin-fs');
		const loaded = await augmentSchema();
		expect(readTextFile).toHaveBeenCalledWith('resources/csl/schema.json', { baseDir: 11 });
		expect(loaded.itemTypes).toHaveLength(schema.itemTypes.length);
	});

	it('keeps every item type, and offers only those it can render', () => {
		expect(augmented.itemTypes.map((t) => t.itemType)).toEqual(
			schema.itemTypes.map((t) => t.itemType)
		);
		expect(augmented.typeFields.map((t) => t.value)).toEqual(mapped.map((t) => t.itemType));
		expect(mapped.length).toBeGreaterThan(30);
	});

	it('labels types and fields for people', () => {
		expect(typeNamed('journalArticle').label).toBe('Journal Article');
		expect(fieldIn('journalArticle', 'publicationTitle').label).toBe('Publication Title');
		expect(augmented.typeFields.find((t) => t.value === 'bookSection')?.label).toBe('Book Section');
	});

	it('gives each field the input its CSL variable needs', () => {
		expect(fieldIn('journalArticle', 'date')).toMatchObject({
			cslField: 'issued',
			inputType: 'date'
		});
		expect(fieldIn('journalArticle', 'volume')).toMatchObject({
			cslField: 'volume',
			inputType: 'number'
		});
		expect(fieldIn('journalArticle', 'pages')).toMatchObject({
			cslField: 'page',
			inputType: 'text'
		});
		expect(fieldIn('journalArticle', 'title')).toMatchObject({
			cslField: 'title',
			inputType: 'text'
		});
	});

	it('maps each creator role to its CSL name variable', () => {
		const roles = Object.fromEntries(
			typeNamed('bookSection').creatorTypes.map((c) => [c.creatorType, c.cslVariable])
		);
		expect(roles).toMatchObject({
			author: 'author',
			bookAuthor: 'container-author',
			editor: 'editor',
			seriesEditor: 'collection-editor',
			translator: 'translator'
		});
		expect(typeNamed('bookSection').creatorTypes[0]).toMatchObject({
			label: 'Author',
			primary: true
		});
	});

	it('maps types both ways where the mapping is one to one', () => {
		for (const type of mapped) {
			const back = augmented.cslToZoteroTypeMap.get(type.cslType!);
			const oneToOne = schema.csl.types[type.cslType!].length === 1;
			if (oneToOne) expect(back, type.itemType).toBe(type.itemType);
			else expect(back, type.itemType).toBeUndefined();
		}
		// Several Zotero types share one CSL type; the form can't guess which.
		expect(augmented.zoteroToCslTypeMap.get('podcast')).toBe('broadcast');
		expect(augmented.zoteroToCslTypeMap.get('radioBroadcast')).toBe('broadcast');
	});

	it('also answers for a hyphenated CSL type written the other way round', () => {
		// Metadata from some services says "journal-article" for "article-journal".
		expect(augmented.cslToZoteroTypeMap.get('journal-article')).toBe('journalArticle');
	});
});

// M1a-6 AC-2
describe('CSL → form → CSL, for every item type the schema maps', () => {
	it.each(mapped.map((t) => [t.itemType, t] as const))('%s', (_, type) => {
		const item = filled(type);

		// Rebuilt from the form alone, with nothing to fall back on.
		expect(fromForm(toForm(item, type), type)).toEqual(item);
		// And written back over itself, which is what saving the sidebar does.
		expect(fromForm(toForm(item, type), type, item)).toEqual(item);
	});

	it('leaves what the form has no field for alone', () => {
		const type = typeNamed('journalArticle');
		const item: CslItem = {
			id: 'aaaa',
			type: 'article-journal',
			title: 'Attention Is All You Need',
			note: 'arXiv: 1706.03762',
			custom: { kept: true }
		};
		expect(fromForm(toForm(item, type), type, item)).toEqual(item);
	});

	it('removes a field that was emptied, rather than printing a blank', () => {
		const type = typeNamed('journalArticle');
		const item: CslItem = { type: 'article-journal', title: 'T', volume: 3 };
		const form = toForm(item, type);
		form.fields.volume = '';
		expect(fromForm(form, type, item)).not.toHaveProperty('volume');
	});

	it('writes the type the form was switched to', () => {
		const book = typeNamed('book');
		const item: CslItem = { type: 'article-journal', title: 'T' };
		expect(fromForm(toForm(item, book), book, item).type).toBe('book');
	});
});

// M1a-6 AC-3
describe('names', () => {
	const type = typeNamed('book');

	it('keeps split names, literal names and particles as they were', () => {
		const item: CslItem = {
			type: 'book',
			author: [
				{ family: 'Beethoven', given: 'Ludwig', 'dropping-particle': 'van' },
				{ family: 'Gogh', given: 'Vincent', 'non-dropping-particle': 'van' },
				{ family: 'King', given: 'Martin Luther', suffix: 'Jr.' },
				{ literal: 'World Health Organization' }
			],
			editor: [{ family: 'Devlin', given: 'Jacob' }]
		};
		const form = toForm(item, type);
		expect(form.creators).toHaveLength(5);
		expect(form.creators[3]).toEqual({
			literal: 'World Health Organization',
			creatorType: 'author'
		});
		expect(fromForm(form, type, item)).toEqual(item);
	});

	it('drops a person left blank, and a role left empty', () => {
		const form = toForm({ type: 'book', author: [{ family: 'A' }] }, type);
		form.creators.push({ creatorType: 'author', family: '  ', given: '' });
		form.creators.push({ creatorType: 'editor', literal: ' ' });
		const item = fromForm(form, type);
		expect(item.author).toEqual([{ family: 'A' }]);
		expect(item).not.toHaveProperty('editor');
	});

	it('prefers the literal when both were typed, and trims', () => {
		const form = toForm({ type: 'book' }, type);
		form.creators.push({ creatorType: 'author', literal: ' Unesco ', family: 'ignored' });
		form.creators.push({ creatorType: 'author', family: ' Kuhn ', given: 'Thomas S. ' });
		expect(fromForm(form, type).author).toEqual([
			{ literal: 'Unesco' },
			{ family: 'Kuhn', given: 'Thomas S.' }
		]);
	});
});

// M1a-6 AC-3
describe('dates', () => {
	it.each([
		[{ 'date-parts': [[2017]] }, '2017'],
		[{ 'date-parts': [[2017, 6]] }, '2017-06'],
		[{ 'date-parts': [[2017, 6, 12]] }, '2017-06-12'],
		[{ 'date-parts': [[2017, 6], [2018]] }, '2017-06/2018'],
		[{ 'date-parts': [['2019', '3']] }, '2019-03'],
		[{ literal: 'Spring 2019' }, 'Spring 2019'],
		[{ raw: '2019-ish' }, '2019-ish'],
		[{}, ''],
		['1999', '1999'],
		[undefined, '']
	])('%j reads as %s', (date, text) => {
		expect(dateToText(date)).toBe(text);
	});

	it.each([
		['2017', { 'date-parts': [[2017]] }],
		['2017-06', { 'date-parts': [[2017, 6]] }],
		[' 2017-6-2 ', { 'date-parts': [[2017, 6, 2]] }],
		['2017-06/2018', { 'date-parts': [[2017, 6], [2018]] }],
		['-44', { 'date-parts': [[-44]] }],
		['2017-13', { literal: '2017-13' }],
		['2017-02-40', { literal: '2017-02-40' }],
		['Spring 2019', { literal: 'Spring 2019' }],
		['n.d.', { literal: 'n.d.' }],
		['', undefined]
	])('%s is written as %j', (text, date) => {
		expect(textToDate(text)).toEqual(date);
	});

	it('keeps a partial date partial through the form', () => {
		const type = typeNamed('book');
		const item: CslItem = { type: 'book', issued: { 'date-parts': [[1962]] } };
		expect(toForm(item, type).fields.date).toBe('1962');
		expect(fromForm(toForm(item, type), type)).toEqual(item);
	});

	it('leaves a date written some other way alone unless it was edited', () => {
		const type = typeNamed('book');
		const item: CslItem = { type: 'book', issued: { raw: '1962?', circa: true } };
		expect(fromForm(toForm(item, type), type, item)).toEqual(item);

		const form = toForm(item, type);
		form.fields.date = '1962-05';
		expect(fromForm(form, type, item).issued).toEqual({ 'date-parts': [[1962, 5]] });
	});
});

// M1a-6 AC-3: a value several fields or variables could hold.
describe('fields with more than one meaning', () => {
	it('puts a place where the type means it', () => {
		expect(fieldIn('presentation', 'place').cslField).toBe('event-place');
		expect(fieldIn('conferencePaper', 'place').cslField).toBe('event-place');
		expect(fieldIn('book', 'place').cslField).toBe('publisher-place');
	});

	it('reads a short title as the CSL short title', () => {
		expect(fieldIn('journalArticle', 'shortTitle').cslField).toBe('title-short');
	});

	it('keeps numbers numbers when they were, and text when they are not', () => {
		const type = typeNamed('journalArticle');
		const item: CslItem = { type: 'article-journal', volume: 12, issue: '3' };
		const form = toForm(item, type);
		form.fields.volume = '13';
		form.fields.issue = 'Suppl. 2';
		const saved = fromForm(form, type, item);
		expect(saved.volume).toBe(13);
		expect(saved.issue).toBe('Suppl. 2');
	});
});

/**
 * The tie-breaks for a Zotero field that more than one CSL variable claims.
 *
 * Zotero's current schema only has two such fields (place and shortTitle), but
 * the rules cover the others its schema has had, and the next version may
 * bring them back. Each is checked against a schema that makes it ambiguous.
 */
describe('choosing between CSL variables', () => {
	function choose(itemType: string, zoteroField: string, candidates: string[]) {
		const synthetic: OriginalZoteroSchema = {
			version: 1,
			itemTypes: [{ itemType, fields: [{ field: zoteroField }], creatorTypes: [] }],
			csl: {
				types: { 'article-journal': [itemType] },
				fields: {
					text: Object.fromEntries(candidates.map((c) => [c, [zoteroField]])),
					date: {}
				},
				names: {}
			}
		};
		return augment(synthetic).itemTypes[0].fields[0].cslField;
	}

	it.each([
		['book', 'shortTitle', ['shortTitle', 'x'], 'shortTitle'],
		['book', 'place', ['event-place', 'publisher-place'], 'publisher-place'],
		['hearing', 'repositoryLocation', ['event-place', 'publisher-place'], 'event-place'],
		['book', 'accessDate', ['accessed', 'x'], 'accessed'],
		['patent', 'filingDate', ['submitted', 'x'], 'submitted'],
		['case', 'dateDecided', ['issued', 'x'], 'issued'],
		['standard', 'number', ['number', 'x'], 'number'],
		['report', 'reportNumber', ['number', 'x'], 'number'],
		['journalArticle', 'issue', ['issue', 'x'], 'issue'],
		['journalArticle', 'volume', ['volume', 'x'], 'volume'],
		['statute', 'codeVolume', ['volume', 'x'], 'volume'],
		['case', 'firstPage', ['page', 'x'], 'page'],
		['hearing', 'session', ['chapter-number', 'x'], 'chapter-number'],
		['thesis', 'thesisType', ['genre', 'x'], 'genre'],
		['dataset', 'type', ['genre', 'x'], 'genre'],
		['artwork', 'artworkMedium', ['medium', 'x'], 'medium'],
		['book', 'mystery', ['a', 'b'], undefined],
		['book', 'unmapped', [], undefined]
	])('%s.%s among %j is %s', (itemType, field, candidates, chosen) => {
		expect(choose(itemType, field, candidates)).toBe(chosen);
	});

	it('gives a field with no CSL variable no input', () => {
		const synthetic: OriginalZoteroSchema = {
			version: 1,
			itemTypes: [{ itemType: 'note', fields: [{ field: 'extra' }], creatorTypes: [] }],
			csl: { types: {}, fields: { text: {}, date: {} }, names: {} }
		};
		const [type] = augment(synthetic).itemTypes;
		expect(type.fields[0]).toMatchObject({ cslField: undefined, inputType: undefined });
		expect(augment(synthetic).typeFields).toEqual([]);
	});
});
