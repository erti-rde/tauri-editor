import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { filesIn, mendeleyText, parseBibtex, toCsl, TYPES } from './bibtex';

const fixture = (name: string) => readFileSync(resolve('src/lib/import/fixtures', name), 'utf8');

const read = (name: string) => {
	const { entries } = parseBibtex(fixture(name));
	return new Map(entries.map((e) => [e.key, e.item]));
};

describe('titles keep their case', () => {
	// M1b-9 AC-2: the parser's default would give "übermensch & co.: the dna of…".
	it('as the exporter wrote them, protected words and all', () => {
		const items = read('better-bibtex.bib');
		expect(items.get('nietzsche2020')?.title).toBe(
			'Übermensch & Co.: The DNA of <i>Thus Spoke Zarathustra</i>'
		);
		expect(items.get('nietzsche2020')?.['title-short']).toBe('Übermensch & Co.');
		expect(items.get('arendt1958')?.title).toBe('The Human Condition');
	});

	// M1b-9 AC-2
	it('and in sentence case where that is how they were written', () => {
		expect(read('google-scholar.bib').get('rawls1958justice')?.title).toBe('Justice as fairness');
	});

	// M1b-9 AC-2
	it('with no langid at all, which the parser takes to mean English', () => {
		const { entries } = parseBibtex('@article{a, title = {The Origin of Species}}');
		expect(entries[0].item.title).toBe('The Origin of Species');
	});
});

/*
 * M1b-9 AC-3: each exporter's own way of writing an entry, read into CSL.
 * One row per field that exporter writes its own way.
 */
describe.each<[string, string, string, unknown]>([
	// Zotero with Better BibTeX: BibLaTeX fields, `date`, `journaltitle`, files bare or described.
	['better-bibtex.bib', 'nietzsche2020', 'type', 'article-journal'],
	['better-bibtex.bib', 'nietzsche2020', 'container-title', 'Journal of Nietzsche Studies'],
	['better-bibtex.bib', 'nietzsche2020', 'container-title-short', 'J. Nietzsche Stud.'],
	[
		'better-bibtex.bib',
		'nietzsche2020',
		'author',
		[
			{ family: 'Nietzsche', given: 'Friedrich' },
			{ family: 'Berg', given: 'Jan', 'non-dropping-particle': 'van der' },
			{ literal: 'World Health Organization' }
		]
	],
	['better-bibtex.bib', 'nietzsche2020', 'issued', { 'date-parts': [[2020, 3, 5]] }],
	['better-bibtex.bib', 'nietzsche2020', 'accessed', { 'date-parts': [[2024, 1, 5]] }],
	['better-bibtex.bib', 'nietzsche2020', 'issue', '1'],
	['better-bibtex.bib', 'nietzsche2020', 'page', '12-34'],
	['better-bibtex.bib', 'nietzsche2020', 'DOI', '10.5555/jns.2020.0001'],
	['better-bibtex.bib', 'nietzsche2020', 'ISSN', '0968-8005'],
	['better-bibtex.bib', 'nietzsche2020', 'language', 'en'],
	['better-bibtex.bib', 'nietzsche2020', 'keyword', 'case, titles'],
	['better-bibtex.bib', 'nietzsche2020', 'citation-key', 'nietzsche2020'],
	['better-bibtex.bib', 'arendt1958', 'type', 'book'],
	[
		'better-bibtex.bib',
		'arendt1958',
		'collection-title',
		'Charles R. Walgreen Foundation Lectures'
	],
	['better-bibtex.bib', 'arendt1958', 'publisher', 'University of Chicago Press'],
	['better-bibtex.bib', 'arendt1958', 'publisher-place', 'Chicago'],
	['better-bibtex.bib', 'arendt1958', 'ISBN', '978-0-226-02598-2'],
	['better-bibtex.bib', 'fricker2017', 'type', 'chapter'],
	[
		'better-bibtex.bib',
		'fricker2017',
		'container-title',
		'The Routledge Handbook of Epistemic Injustice'
	],
	[
		'better-bibtex.bib',
		'fricker2017',
		'editor',
		[
			{ family: 'Kidd', given: 'Ian James' },
			{ family: 'Medina', given: 'José' },
			{ family: 'Pohlhaus', given: 'Gaile', suffix: 'Jr.' }
		]
	],
	['better-bibtex.bib', 'okafor2021', 'type', 'thesis'],
	['better-bibtex.bib', 'okafor2021', 'genre', 'PhD thesis'],
	['better-bibtex.bib', 'okafor2021', 'publisher', 'University of Edinburgh'],
	['better-bibtex.bib', 'okafor2021', 'issued', { 'date-parts': [[2021, 9]] }],
	['better-bibtex.bib', 'who2023', 'type', 'webpage'],
	['better-bibtex.bib', 'who2023', 'author', [{ literal: 'World Health Organization' }]],
	['better-bibtex.bib', 'who2023', 'URL', 'https://example.org/who/hypertension'],

	// Mendeley Desktop: double-braced titles, `{\_}` in links, a preamble of prose.
	['mendeley.bib', 'Smith2019', 'title', 'Reading Kant Late'],
	['mendeley.bib', 'Smith2019', 'container-title', 'Mind'],
	['mendeley.bib', 'Smith2019', 'issue', '512'],
	['mendeley.bib', 'Smith2019', 'URL', 'https://example.org/mind/128/512/1021_a'],
	['mendeley.bib', 'Smith2019', 'abstract', 'We read Kant late, and closely.'],
	['mendeley.bib', 'Smith2019', 'mendeley-groups', undefined],
	['mendeley.bib', 'Beauvoir1949', 'title', 'Le Deuxième Sexe'],
	[
		'mendeley.bib',
		'Beauvoir1949',
		'author',
		[{ family: 'Beauvoir', given: 'Simone', 'non-dropping-particle': 'de' }]
	],
	['mendeley.bib', 'Lee2018', 'type', 'paper-conference'],
	[
		'mendeley.bib',
		'Lee2018',
		'container-title',
		'Proceedings of the 56th Annual Meeting of the Association for Computational Linguistics'
	],

	// JabRef: capitalised entry types, "First Last" names, `month = apr`, a trailing comma.
	['jabref.bib', 'Beauvoir1949', 'type', 'book'],
	[
		'jabref.bib',
		'Beauvoir1949',
		'author',
		[{ family: 'Beauvoir', given: 'Simone', 'non-dropping-particle': 'de' }]
	],
	['jabref.bib', 'Rawls1958', 'author', [{ family: 'Rawls', given: 'John' }]],
	['jabref.bib', 'Rawls1958', 'issued', { 'date-parts': [[1958, 4]] }],
	['jabref.bib', 'Rawls1958', 'issue', '2'],
	['jabref.bib', 'Haraway1988', 'type', 'chapter'],
	['jabref.bib', 'Haraway1988', 'container-title', 'Simians, Cyborgs, and Women'],
	['jabref.bib', 'Note2020', 'type', 'document'],
	['jabref.bib', 'Note2020', 'URL', 'https://example.org/note'],

	// Google Scholar: lower-case titles and journals, `and others`, no DOI.
	['google-scholar.bib', 'rawls1958justice', 'container-title', 'The philosophical review'],
	['google-scholar.bib', 'rawls1958justice', 'publisher', 'JSTOR'],
	[
		'google-scholar.bib',
		'vaswani2017attention',
		'author',
		[
			{ family: 'Vaswani', given: 'Ashish' },
			{ family: 'Shazeer', given: 'Noam' },
			{ family: 'Parmar', given: 'Niki' }
		]
	],
	['google-scholar.bib', 'vaswani2017attention', 'type', 'paper-conference'],
	['google-scholar.bib', 'okafor2021reading', 'genre', 'PhD thesis'],
	['google-scholar.bib', 'okafor2021reading', 'publisher', 'The University of Edinburgh'],
	['google-scholar.bib', 'arendt1958human', 'DOI', undefined]
])('%s › %s', (file, key, field, expected) => {
	// M1b-9 AC-3
	it(`reads ${field}`, () => {
		const item = read(file).get(key);
		expect(item, `${key} is read`).toBeDefined();
		expect(item?.[field]).toEqual(expected);
	});
});

describe('every fixture', () => {
	// M1b-9 AC-3
	it.each(['better-bibtex.bib', 'mendeley.bib', 'jabref.bib', 'google-scholar.bib'])(
		'%s is read whole, with no entry lost',
		(file) => {
			const text = fixture(file);
			const { entries, unreadable } = parseBibtex(text);
			const written = (text.match(/^@(?!comment|string|preamble)\w+\s*\{/gim) ?? []).length;
			expect(unreadable).toEqual([]);
			expect(entries).toHaveLength(written);
		}
	);
});

describe('entry types', () => {
	// M1b-9 AC-3
	it.each([
		['article', 'article-journal'],
		['inproceedings', 'paper-conference'],
		['conference', 'paper-conference'],
		['incollection', 'chapter'],
		['inbook', 'chapter'],
		['techreport', 'report'],
		['mastersthesis', 'thesis'],
		['unpublished', 'manuscript'],
		['online', 'webpage'],
		['dataset', 'dataset'],
		['software', 'software'],
		['misc', 'document']
	])('@%s is a CSL %s', (bibtex, csl) => {
		expect(TYPES[bibtex]).toBe(csl);
		expect(toCsl({ type: bibtex, key: 'k', fields: {} }).type).toBe(csl);
	});

	// M1b-9 AC-3
	it('an unknown type is a document, and an article in a magazine is said so', () => {
		expect(toCsl({ type: 'whatnot', key: 'k', fields: {} }).type).toBe('document');
		expect(toCsl({ type: 'article', key: 'k', fields: { entrysubtype: 'magazine' } }).type).toBe(
			'article-magazine'
		);
	});

	// M1b-9 AC-3
	it('a numbered book in a series keeps its number as the series’, an article’s as its issue', () => {
		expect(
			toCsl({ type: 'book', key: 'k', fields: { series: 'Lectures', number: '7' } })
		).toMatchObject({ 'collection-title': 'Lectures', 'collection-number': '7' });
		expect(toCsl({ type: 'techreport', key: 'k', fields: { number: 'TR-9' } })).toMatchObject({
			number: 'TR-9'
		});
	});
});

describe('the files an entry names', () => {
	// M1b-9 AC-3: as each exporter writes a `file` field.
	it.each<[string, string, string[]]>([
		[
			'Better BibTeX, bare',
			'/Users/ana/Zotero/storage/AB/a.pdf',
			['/Users/ana/Zotero/storage/AB/a.pdf']
		],
		[
			'Zotero, described, with a snapshot beside it',
			'Full Text PDF:/Users/ana/a.pdf:application/pdf;Snapshot:/Users/ana/s.html:text/html',
			['/Users/ana/a.pdf']
		],
		[
			'Windows, escaped',
			'Full Text:C\\:\\\\Users\\\\ana\\\\a.pdf:application/pdf',
			['C:\\Users\\ana\\a.pdf']
		],
		[
			'Mendeley on a Mac, its leading slash gone',
			':Users/jane/Mendeley/a.pdf:pdf',
			['/Users/jane/Mendeley/a.pdf']
		],
		['Mendeley on Windows', ':C$\\backslash$:/Users/jane/a.pdf:pdf', ['C:/Users/jane/a.pdf']],
		[
			'Mendeley, an accent in the name',
			':Users/j/Deuxi{\\`{e}}me.pdf:pdf',
			['/Users/j/Deuxième.pdf']
		],
		['JabRef, beside the .bib', ':Beauvoir1949.pdf:PDF', ['Beauvoir1949.pdf']],
		['JabRef, described', 'Rawls:papers/Rawls1958.pdf:PDF', ['papers/Rawls1958.pdf']],
		['not a PDF', 'Snapshot:/Users/ana/s.html:text/html', []],
		['empty', '', []]
	])('%s', (_, field, paths) => {
		expect(filesIn(field)).toEqual(paths);
	});

	it('in the fixtures', () => {
		const { entries } = parseBibtex(fixture('mendeley.bib'));
		expect(entries.find((e) => e.key === 'Beauvoir1949')?.files).toEqual([
			'C:/Users/jane/Mendeley/Beauvoir - 1949 - Le Deuxième Sexe.pdf'
		]);
	});

	it('leaves a Windows path’s backslashes alone where Mendeley’s braces aren’t', () => {
		expect(mendeleyText('C:\\users\\uma')).toBe('C:\\users\\uma');
		expect(mendeleyText('a{\\_}b{\\%}20{\\"{o}}')).toBe('a_b%20ö');
	});
});

describe('entries that can’t be read', () => {
	// M1b-9 AC-4: listed by key and line, and the rest read anyway.
	it('are said with their key, the line they start on and why', () => {
		const text = [
			'@article{first, title = {Fine}}',
			'',
			'@book{broken, title = {Never closed',
			'',
			'@misc{last, title = {Also fine}}'
		].join('\n');
		const { entries, unreadable } = parseBibtex(text);
		expect(unreadable).toEqual([
			{ key: 'broken', line: 3, reason: 'A brace or quote is never closed.' }
		]);
		expect(entries.map((e) => [e.key, e.line])).toEqual([
			['first', 1],
			['last', 5]
		]);
	});

	it('a command the parser doesn’t know keeps its text', () => {
		const { entries, unreadable } = parseBibtex('@misc{a, title = {A \\madeup{word} here}}');
		expect(unreadable).toEqual([]);
		expect(entries[0].item.title).toBe('A word here');
	});
});

describe('accents', () => {
	// M1b-9 AC-3: written as LaTeX, read as the letters a person types.
	it('are composed, in titles and names alike', () => {
		const { entries } = parseBibtex(
			"@book{a, title = {Le Deuxi{\\`e}me Sexe}, author = {Medina, Jos{\\'e}}}"
		);
		expect(entries[0].item.title).toBe('Le Deuxième Sexe'.normalize('NFC'));
		expect(entries[0].item.author).toEqual([{ family: 'Medina', given: 'José'.normalize('NFC') }]);
	});
});
