import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CitationEngine } from '$lib/citations/engine';
import type { CitationItem } from '$lib/stores/citationStore';

import { augment, type OriginalZoteroSchema } from './adapterCslZotero';
import { fromForm, toForm, type FormCreator } from './cslForm';
import {
	FIRST_TYPES,
	isRequired,
	itemTypeOf,
	missing,
	newSourceId,
	typeChoices
} from './sourceForm';

const CSL = resolve(process.cwd(), 'src-tauri/resources/csl');
const schema = augment(
	JSON.parse(readFileSync(resolve(CSL, 'schema.json'), 'utf8')) as OriginalZoteroSchema
);
const typeNamed = (name: string) => schema.itemTypes.find((t) => t.itemType === name)!;

/** What a researcher would type into the form for each kind, by Zotero field. */
const ENTERED: Record<string, { fields: Record<string, string>; creators: FormCreator[] }> = {
	book: {
		fields: { title: 'Orality and Literacy', publisher: 'Methuen', place: 'London', date: '1982' },
		creators: [{ creatorType: 'author', family: 'Ong', given: 'Walter J.' }]
	},
	bookSection: {
		fields: {
			title: 'The Ethnographic Present',
			bookTitle: 'Writing Culture',
			publisher: 'University of California Press',
			place: 'Berkeley',
			date: '1986',
			pages: '51-76'
		},
		creators: [
			{ creatorType: 'author', family: 'Fabian', given: 'Johannes' },
			{ creatorType: 'editor', family: 'Clifford', given: 'James' }
		]
	},
	webpage: {
		fields: {
			title: 'Citation Style Language',
			websiteTitle: 'CitationStyles.org',
			url: 'https://citationstyles.org/',
			date: '2023-05-01',
			accessDate: '2024-02-10'
		},
		creators: [{ creatorType: 'author', literal: 'CSL Project' }]
	},
	report: {
		fields: {
			title: 'Open Access Monographs in the UK',
			institution: 'Jisc',
			place: 'Bristol',
			reportNumber: '12',
			date: '2019'
		},
		creators: [{ creatorType: 'author', family: 'Crossick', given: 'Geoffrey' }]
	},
	thesis: {
		fields: {
			title: 'Reading Machines',
			thesisType: 'PhD thesis',
			university: 'University of Edinburgh',
			place: 'Edinburgh',
			date: '2015'
		},
		creators: [{ creatorType: 'author', family: 'Smith', given: 'Ada' }]
	}
};

function entered(itemType: string) {
	const type = typeNamed(itemType);
	const blank = toForm({}, type);
	const { fields, creators } = ENTERED[itemType];
	return fromForm({ ...blank, fields: { ...blank.fields, ...fields }, creators }, type, {
		id: 'erti:x'
	});
}

function bibliography(style: string, itemType: string): string {
	const item = entered(itemType);
	const engine = new CitationEngine({
		styleXml: readFileSync(resolve(CSL, `styles/${style}.csl`), 'utf8'),
		localeXml: readFileSync(resolve(CSL, 'locales/locales-en-GB.xml'), 'utf8'),
		sources: { 'erti:x': { ...item, id: 'erti:x' } as CitationItem }
	});
	engine.render([{ id: 'c1', itemIds: ['erti:x'] }]);
	return engine
		.bibliography()[0]
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Read and checked against each style's own examples, then pinned. A chapter
 * without its book, a report without its institution, a thesis without its
 * university or a web page without its site was what this first caught: Zotero
 * maps those fields through a base field, and the form dropped them.
 */
const EXPECTED: Record<string, Record<string, string>> = {
	book: {
		apa: 'Ong, W. J. (1982). Orality and Literacy. Methuen.',
		'chicago-notes-bibliography': 'Ong, Walter J. Orality and Literacy. Methuen, 1982.',
		ieee: '[1]W. J. Ong, Orality and Literacy. London: Methuen, 1982.'
	},
	bookSection: {
		apa: 'Fabian, J. (1986). The Ethnographic Present. In J. Clifford (Ed.), Writing Culture (pp. 51–76). University of California Press.',
		'chicago-notes-bibliography':
			'Fabian, Johannes. ‘The Ethnographic Present’. In Writing Culture, edited by James Clifford. University of California Press, 1986.',
		ieee: '[1]J. Fabian, ‘The Ethnographic Present’, in Writing Culture, J. Clifford, Ed., Berkeley: University of California Press, 1986, pp. 51–76.'
	},
	webpage: {
		apa: 'CSL Project. (2023, May 1). Citation Style Language. CitationStyles.Org. https://citationstyles.org/',
		'chicago-notes-bibliography':
			'CSL Project. ‘Citation Style Language’. CitationStyles.Org, 1 May 2023. https://citationstyles.org/.',
		ieee: '[1]CSL Project, ‘Citation Style Language’, CitationStyles.org. Accessed: Feb. 10, 2024. [Online]. Available: https://citationstyles.org/'
	},
	report: {
		apa: 'Crossick, G. (2019). Open Access Monographs in the UK (No. 12). Jisc.',
		'chicago-notes-bibliography':
			'Crossick, Geoffrey. Open Access Monographs in the UK. No. 12. Jisc, 2019.',
		ieee: '[1]G. Crossick, ‘Open Access Monographs in the UK’, Jisc, Bristol, 12, 2019.'
	},
	thesis: {
		apa: 'Smith, A. (2015). Reading Machines [PhD thesis]. University of Edinburgh.',
		'chicago-notes-bibliography':
			'Smith, Ada. ‘Reading Machines’. PhD thesis, University of Edinburgh, 2015.',
		ieee: '[1]A. Smith, ‘Reading Machines’, PhD thesis, University of Edinburgh, Edinburgh, 2015.'
	}
};

describe('rendered, from what was typed (M1b-5 AC-3)', () => {
	const cases = Object.entries(EXPECTED).flatMap(([itemType, styles]) =>
		Object.entries(styles).map(([style, text]) => [itemType, style, text] as const)
	);

	it.each(cases)('%s in %s', (itemType, style, text) => {
		expect(bibliography(style, itemType)).toBe(text);
	});
});

describe('the form (M1b-5 AC-1)', () => {
	it('offers the common kinds first, then the rest A to Z', () => {
		const choices = typeChoices(schema);
		expect(choices.slice(0, 6).map((c) => c.value)).toEqual(FIRST_TYPES);
		const rest = choices.slice(6).map((c) => c.label);
		expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
		expect(choices.every((c) => typeNamed(c.value).cslType)).toBe(true);
	});

	it('marks the title, and what each kind is cited from, as required', () => {
		expect(isRequired('book', 'title')).toBe(true);
		expect(isRequired('book', 'publisher')).toBe(false);
		expect(isRequired('bookSection', 'bookTitle')).toBe(true);
		expect(isRequired('webpage', 'url')).toBe(true);
		expect(isRequired('thesis', 'university')).toBe(true);
	});

	it('says which required fields are empty, and how to fill them', () => {
		const type = typeNamed('bookSection');
		const form = toForm({}, type);
		expect(missing(form, type)).toEqual({
			title: 'Enter the title.',
			bookTitle: 'Enter the book title.'
		});
		form.fields.title = 'The Ethnographic Present';
		form.fields.bookTitle = '  ';
		expect(Object.keys(missing(form, type))).toEqual(['bookTitle']);
	});

	it('makes ids no file hash can be', () => {
		expect(newSourceId()).toMatch(
			/^erti:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
		);
	});
});

describe('an existing source (M1b-5 AC-5)', () => {
	it('shows its recorded kind', () => {
		expect(itemTypeOf('conferencePaper', { type: 'paper-conference' }, schema)).toBe(
			'conferencePaper'
		);
	});

	it('works out the kind of a source resolved before the kind was kept', () => {
		expect(itemTypeOf(null, { type: 'chapter', title: 'x' }, schema)).toBe('bookSection');
		expect(itemTypeOf(null, { type: 'article-journal' }, schema)).toBe('journalArticle');
	});

	it('leaves it to the researcher when nothing says', () => {
		expect(itemTypeOf(null, null, schema)).toBeUndefined();
		expect(itemTypeOf('notAType', { type: 'nonsense' }, schema)).toBeUndefined();
	});
});
