import { describe, expect, it } from 'vitest';

import type { MatchedPassage, Span } from '$lib/ipc';

import {
	anyLongEnough,
	excerpt,
	findingId,
	pageOf,
	quotationOf,
	sentenceHash,
	shortName,
	sourceDifferences,
	sourceSays,
	sourceWordsFor,
	toChecked,
	wordOffsets
} from './findings';
import type { Sentence } from './sentences';

const span = (over: Partial<Span>): Span => ({
	sentence: 0,
	passage: 0,
	sentenceWords: [0, 6],
	passageWords: [0, 6],
	sharedWords: 6,
	verbatimScore: 1,
	sources: [1],
	...over
});

const passage = (text: string, over: Partial<MatchedPassage> = {}): MatchedPassage => ({
	kind: 'chunk',
	work: 'w',
	file: 'w',
	id: null,
	page: 2,
	pageLabel: null,
	text,
	...over
});

describe('reading a sentence for the check', () => {
	// M4-5 AC-3
	it('gives the classifier its citations by canonical id, once each', () => {
		const sentence: Sentence = {
			text: 'Words.',
			from: 1,
			to: 7,
			citations: [
				{ at: 3, ids: ['scan', 'paper'] },
				{ at: 6, ids: ['book'] }
			],
			quoted: true,
			positions: []
		};
		const canonical = (id: string) => (id === 'scan' ? 'book' : id);
		expect(toChecked(sentence, canonical)).toEqual({
			text: 'Words.',
			cites: ['book', 'paper'],
			quoted: true
		});
	});

	// M4-5 AC-2
	it('knows when no sentence is long enough to compare', () => {
		expect(anyLongEnough([{ text: 'Five words are not enough.' }])).toBe(false);
		expect(anyLongEnough([{ text: 'Six words are just about enough.' }])).toBe(true);
	});
});

describe('the words a finding is about', () => {
	const text = 'As shown, “recurrence dominates translation” in every model since.';

	// M4-5 AC-4
	it('finds a word range in what was written', () => {
		const at = wordOffsets(text, [2, 5])!;
		expect(text.slice(...at)).toBe('recurrence dominates translation');
		expect(wordOffsets(text, [3, 3])).toBeNull();
		expect(wordOffsets(text, [0, 99])).toBeNull();
	});

	// M4-5 AC-3
	it('shows the matched words, with an ellipsis where the sentence goes on', () => {
		expect(excerpt(text, [2, 5])).toBe('…recurrence dominates translation…');
		expect(excerpt(text, [0, 2])).toBe('As shown…');
		expect(excerpt('One two three.', [0, 3])).toBe('One two three');
		expect(excerpt('One two three.', [1, 3])).toBe('…two three');
	});

	// M4-6 AC-1
	it('finds the quotation a span falls in', () => {
		const sentence = { text, cites: ['w'], quoted: false };
		const found = quotationOf(sentence, span({ sentenceWords: [3, 5] }))!;
		expect(text.slice(...found.at)).toBe('recurrence dominates translation');
		expect(found.words).toEqual([2, 5]);
		expect(quotationOf(sentence, span({ sentenceWords: [5, 9] }))).toBeNull();
		expect(quotationOf({ ...sentence, quoted: true }, span({}))).toBeNull();
	});
});

describe('where a drifted quotation differs', () => {
	const w = (s: string) => s.split(' ');

	// M4-5 AC-3
	it('names each place the source’s words differ', () => {
		expect(sourceDifferences(w('a b changed d e'), w('a b c d e'))).toEqual([[2, 3]]);
		expect(sourceDifferences(w('a b d'), w('a b c d'))).toEqual([[2, 3]]);
		// Two places apart, not everything between them.
		expect(sourceDifferences(w('x b c d y'), w('a b c d e'))).toEqual([
			[0, 1],
			[4, 5]
		]);
		// A word added to the quotation: the words either side of it.
		expect(sourceDifferences(w('a b x c'), w('a b c'))).toEqual([[1, 3]]);
		expect(sourceDifferences(w('a b c'), w('a b c'))).toEqual([]);
	});

	// M4-5 AC-3
	it('says it as the source wrote it, over the whole quotation', () => {
		const said =
			'BERT “obtains new state of the art results on eleven natural language tasks” here.';
		const source = passage(
			'We obtain new state of the art results on eleven natural language Processing tasks, including'
		);
		// The span holds only the words the two share unbroken.
		const found = span({ sentenceWords: [2, 12], passageWords: [2, 12] });
		const sentence = { text: said, cites: ['w'], quoted: false };
		expect(sourceSays(sentence, found, source)).toBe('obtain … Processing');
	});

	// M4-5 AC-3
	it('compares the span when the quotation can’t be found', () => {
		const said = 'They reported results on eleven natural language tasks today.';
		const source = passage(
			'obtains results on eleven natural language Processing tasks, including'
		);
		const found = span({ sentenceWords: [2, 8], passageWords: [1, 8] });
		const sentence = { text: said, cites: ['w'], quoted: false };
		expect(sourceSays(sentence, found, source)).toBe('Processing');
	});

	// M4-6 AC-1
	it('runs the source’s words out to the quotation’s ends', () => {
		const source = passage('zero one two three four five six seven eight nine');
		// The quotation is words 1–7 of the sentence; the span 2–6, aligned at 3.
		const said = 'x two three four five six seven y';
		const found = span({ sentenceWords: [2, 6], passageWords: [3, 7] });
		expect(sourceWordsFor(said, [1, 7], found, source)).toBe('two three four five six seven');
	});

	// M4-6 AC-1
	it('finds the ends when the quotation dropped a word outside the span', () => {
		const source = passage(
			'We obtain new state of the art results on eleven natural language processing tasks today'
		);
		const said = 'BERT obtains new state of the art results on eleven natural language tasks';
		// "new … language" is the span; "obtains" and "tasks" are outside it.
		const found = span({ sentenceWords: [2, 12], passageWords: [2, 12] });
		expect(sourceWordsFor(said, [1, 13], found, source)).toBe(
			'obtain new state of the art results on eleven natural language processing tasks'
		);
	});

	// M4-6 AC-1
	it('stays inside the passage', () => {
		const source = passage('two three four five six seven');
		const said = 'a b two three four five six seven c d';
		const found = span({ sentenceWords: [2, 8], passageWords: [0, 6] });
		expect(sourceWordsFor(said, [0, 10], found, source)).toBe('two three four five six seven');
	});
});

describe('naming and keying findings', () => {
	// M4-5 AC-3
	it('names a work by its authors and year', () => {
		const csl = (o: object) => JSON.stringify(o);
		const year = { issued: { 'date-parts': [[2017]] } };
		expect(
			shortName(
				csl({
					author: [{ family: 'Vaswani' }, { family: 'Shazeer' }, { family: 'Parmar' }],
					...year
				})
			)
		).toBe('Vaswani et al. 2017');
		expect(shortName(csl({ author: [{ family: 'Ong' }, { family: 'Hartley' }], ...year }))).toBe(
			'Ong and Hartley 2017'
		);
		expect(shortName(csl({ author: [{ literal: 'WHO' }] }))).toBe('WHO');
		expect(shortName(csl({ editor: [{ family: 'Eco' }], ...year }))).toBe('Eco 2017');
		expect(shortName(csl({ title: 'Orality and Literacy' }))).toBe('Orality and Literacy');
		expect(shortName(csl({}))).toBeNull();
		expect(shortName('{not json')).toBeNull();
		expect(shortName(null)).toBeNull();
	});

	// M4-5 AC-3
	it('gives the page as printed, else the sheet', () => {
		expect(pageOf(passage('x', { page: 3, pageLabel: 'xii' }))).toBe('xii');
		expect(pageOf(passage('x', { page: 3 }))).toBe('3');
		expect(pageOf(passage('x', { page: null }))).toBeNull();
	});

	// M4-7 AC-2
	it('keys a dismissal by the sentence’s words, not its spacing or punctuation', async () => {
		const a = await sentenceHash('Indexes encode a view of their users.');
		expect(a).toMatch(/^[0-9a-f]{64}$/);
		expect(await sentenceHash('Indexes  encode a view, of their users')).toBe(a);
		expect(await sentenceHash('Indexes encode a view of their readers.')).not.toBe(a);
	});

	// M4-5 AC-3
	it('tells findings apart by sentence, kind and work', () => {
		expect(findingId({ sentence: 2, kind: 'uncited', work: 'w' })).toBe('2:uncited:w');
	});
});
