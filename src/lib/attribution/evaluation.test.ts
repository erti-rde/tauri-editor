import { describe, expect, it } from 'vitest';

import corpus from '../../../tests/fixtures/retrieval/corpus.json';
import fixtureJson from '../../../tests/fixtures/attribution/sentences.json';
import lastRun from '../../../tests/fixtures/attribution/last-run.json';

import {
	CATEGORIES,
	KINDS,
	baselineCheck,
	checkAgainstCorpus,
	checkLabels,
	formatReport,
	looseWords,
	score,
	type Fixture,
	type LabelledSentence,
	type Passage,
	type Verdict
} from './evaluation';

const fixture = fixtureJson as Fixture;
const corpusIds = corpus.map((paper) => paper.id);

function sentence(patch: Partial<LabelledSentence>): LabelledSentence {
	return {
		id: 's1',
		category: 'verbatim_uncited',
		expect: 'uncited',
		text: 'Every index is an argument about what a reader will want to find.',
		cites: [],
		from: 'p1',
		copied: 'Every index is an argument about what a reader will want to find',
		...patch
	};
}

const small = (sentences: LabelledSentence[], extra: Partial<Fixture> = {}): Fixture => ({
	sources: [
		{ id: 'p1', title: 'One' },
		{ id: 'p2', title: 'Two' }
	],
	notes: [],
	documents: [],
	sentences,
	...extra
});

describe('the labelled set', () => {
	// M4-1 AC-1
	it('has at least 120 sentences', () => {
		expect(fixture.sentences.length).toBeGreaterThanOrEqual(120);
	});

	// M4-1 AC-1
	it('covers every category, ten sentences or more each', () => {
		for (const category of CATEGORIES) {
			const count = fixture.sentences.filter((s) => s.category === category).length;
			expect(count, category).toBeGreaterThanOrEqual(10);
		}
	});

	// M4-1 AC-1
	it('labels every kind the check can report, and sentences with nothing to report', () => {
		for (const kind of KINDS) expect(fixture.sentences.some((s) => s.expect === kind)).toBe(true);
		expect(fixture.sentences.some((s) => s.expect === 'none')).toBe(true);
	});

	// M4-1 AC-1: over the retrieval corpus plus source notes
	it('draws on the retrieval corpus, source notes and the project’s other documents', () => {
		const from = fixture.sentences.map((s) => s.from ?? '');
		expect(from.filter((f) => corpusIds.includes(f)).length).toBeGreaterThan(80);
		expect(from.some((f) => f.startsWith('note:'))).toBe(true);
		expect(from.some((f) => f.startsWith('doc:'))).toBe(true);
	});

	// M4-1 AC-1
	it('is consistent with itself', () => {
		expect(checkLabels(fixture, corpusIds)).toEqual([]);
	});
});

describe('checking the labels', () => {
	it('passes a sentence that carries what it says it copied', () => {
		expect(checkLabels(small([sentence({})]), [])).toEqual([]);
	});

	it('refuses a sentence missing the words it says it copied', () => {
		const problems = checkLabels(small([sentence({ copied: 'words that are not there' })]), []);
		expect(problems).toEqual([expect.stringContaining('does not carry')]);
	});

	it('refuses a citation of a source nobody has', () => {
		const problems = checkLabels(small([sentence({ cites: ['p9'] })]), []);
		expect(problems).toEqual(['s1: cites unknown source p9']);
	});

	it('refuses a repeated id', () => {
		const problems = checkLabels(small([sentence({}), sentence({})]), []);
		expect(problems).toContain('s1: duplicate id');
	});

	it('refuses a quotation without quotation marks', () => {
		const problems = checkLabels(
			small([sentence({ category: 'quoted_cited_exact', expect: 'none', cites: ['p1'] })]),
			[]
		);
		expect(problems).toContain('s1: should quote, and does not');
	});

	it('refuses a drifted quotation that carries the source’s words exactly', () => {
		const text = '“Every index is an argument about what a reader will want to find.”';
		const problems = checkLabels(
			small([
				sentence({ category: 'drifted_quote', expect: 'drifted_quote', text, cites: ['p1'] })
			]),
			[]
		);
		expect(problems).toContain('s1: carries the source words exactly, so has not drifted');
	});

	it('refuses a paraphrase that shares four words running with its source', () => {
		const problems = checkLabels(
			small([
				sentence({
					category: 'clean_paraphrase',
					expect: 'none',
					copied: undefined,
					text: 'An index is an argument about readers.',
					paraphrases: 'Every index is an argument about what a reader will want to find.'
				})
			]),
			[]
		);
		expect(problems).toEqual([expect.stringContaining('shares "index is an argument"')]);
	});

	it('refuses words a note does not have', () => {
		const note = {
			id: 'n1',
			source: 'p1',
			kind: 'source_note' as const,
			quote: 'Other words.',
			body: ''
		};
		const problems = checkLabels(small([sentence({ from: 'note:n1' })], { notes: [note] }), []);
		expect(problems).toEqual([expect.stringContaining('note:n1 lacks')]);
	});
});

describe('checking the labels against the corpus', () => {
	const passages: Passage[] = [
		{
			source: 'p1',
			kind: 'chunk',
			text: 'We think every index is an argument about what a reader will want to find, and more.'
		},
		{ source: 'p2', kind: 'chunk', text: 'The a\u008aractive forces pull neighbours together.' }
	];

	it('passes words that are in the paper named', () => {
		expect(checkAgainstCorpus(small([sentence({})]), passages)).toEqual([]);
	});

	it('notices when the paper no longer has them', () => {
		const problems = checkAgainstCorpus(small([sentence({ from: 'p2' })]), passages);
		expect(problems).toEqual([expect.stringContaining('p2 lacks')]);
	});

	it('checks mangled text exactly as extracted', () => {
		const pdf = (as_extracted: string) =>
			sentence({
				category: 'pdf_artefact',
				from: 'p2',
				text: 'The attractive forces pull neighbours together.',
				copied: 'The attractive forces pull neighbours together',
				as_extracted
			});
		expect(checkAgainstCorpus(small([pdf('The a\u008aractive forces')]), passages)).toEqual([]);
		expect(checkAgainstCorpus(small([pdf('The attractive forces')]), passages)).toEqual([
			expect.stringContaining('as extracted')
		]);
	});

	it('counts the sources a stock phrase is in, and wants ten', () => {
		const stock = sentence({
			category: 'stock_phrase',
			expect: 'none',
			from: undefined,
			copied: undefined,
			stock: 'what a reader will want to find'
		});
		expect(checkAgainstCorpus(small([stock]), passages)).toEqual([
			's1: "what a reader will want to find" is in 1 sources, not 10'
		]);
	});
});

describe('the scores', () => {
	const sentences = [
		sentence({ id: 'a', expect: 'uncited' }),
		sentence({ id: 'b', expect: 'uncited' }),
		sentence({ id: 'c', category: 'stock_phrase', expect: 'none' }),
		sentence({ id: 'd', category: 'self_reuse', expect: 'self_reuse' })
	];
	const verdicts = new Map<string, Verdict>([
		['a', 'uncited'],
		['c', 'uncited'],
		['d', 'self_reuse']
	]);
	const report = score('test', sentences, verdicts);

	// M4-1 AC-2
	it('counts each category’s verdicts, as a row of the matrix', () => {
		expect(report.categories.verbatim_uncited).toMatchObject({ n: 2, right: 1 });
		expect(report.categories.verbatim_uncited.got).toMatchObject({ uncited: 1, none: 1 });
		expect(report.categories.stock_phrase.got).toMatchObject({ uncited: 1, none: 0 });
	});

	// M4-1 AC-2
	it('gives each kind its precision and recall', () => {
		expect(report.kinds.uncited).toEqual({
			labelled: 2,
			reported: 2,
			right: 1,
			precision: 0.5,
			recall: 0.5
		});
		expect(report.kinds.self_reuse).toMatchObject({ precision: 1, recall: 1 });
		expect(report.kinds.wrong_source).toMatchObject({ precision: null, recall: null });
	});

	it('lists what it got wrong', () => {
		expect(report.wrong.map((w) => [w.id, w.got])).toEqual([
			['b', 'none'],
			['c', 'uncited']
		]);
	});

	// M4-1 AC-2
	it('prints the matrix with a row per category and a line per kind', () => {
		const printed = formatReport(report);
		for (const category of CATEGORIES) expect(printed).toMatch(new RegExp(`^${category} `, 'm'));
		for (const kind of KINDS) expect(printed).toMatch(new RegExp(`^${kind} `, 'm'));
		expect(printed).toMatch(/^verbatim_uncited\s+2\s+1\s+1\s+0\s+0\s+0\s+1\/2$/m);
	});

	// M4-1 AC-2
	it('is recorded in last-run.json for the set as it stands', () => {
		expect(lastRun.sentences).toBe(fixture.sentences.length);
		expect(Object.keys(lastRun.categories)).toEqual([...CATEGORIES]);
		const total = CATEGORIES.reduce((n, c) => n + lastRun.categories[c].n, 0);
		expect(total).toBe(fixture.sentences.length);
	});
});

describe('the baseline', () => {
	const passages: Passage[] = [
		{
			source: 'p1',
			kind: 'chunk',
			text: 'Every index is an argument about what a reader will want to find, made before the reader arrives.'
		},
		{
			source: 'doc:d1',
			kind: 'document',
			text: 'We study how researchers move between their reading notes and their drafts.'
		}
	];
	const check = (text: string, cites: string[] = []) =>
		baselineCheck([{ id: 'x', text, cites }], passages).get('x');

	it('reports copied words with no citation', () => {
		expect(check('Every index is an argument about what a reader will want to find.')).toBe(
			'uncited'
		);
	});

	it('says nothing of copied words cited to their source', () => {
		expect(check('Every index is an argument about what a reader will want to find.', ['p1'])).toBe(
			'none'
		);
	});

	it('reports copied words cited to another source', () => {
		expect(check('Every index is an argument about what a reader will want to find.', ['p2'])).toBe(
			'wrong_source'
		);
	});

	it('says nothing of an exact quotation, and reports one that drifted', () => {
		expect(
			check('Hartley: “every index is an argument about what a reader will want”.', ['p1'])
		).toBe('none');
		expect(
			check('Hartley: “every index is an argument about what readers will want”.', ['p1'])
		).toBe('drifted_quote');
	});

	it('reports the writer’s own words from another document', () => {
		expect(check('We study how researchers move between their reading notes and drafts.')).toBe(
			'self_reuse'
		);
	});

	it('says nothing when fewer than six words run together', () => {
		expect(check('Every index is an argument, and readers will want to find it.')).toBe('none');
	});
});

describe('loose words', () => {
	it('undo ligatures, soft hyphens and line-break hyphens, and keep real hyphens apart', () => {
		expect(looseWords('eﬃcient opti­mize net- works semi-supervised')).toEqual([
			'efficient',
			'optimize',
			'networks',
			'semi',
			'supervised'
		]);
	});
});
