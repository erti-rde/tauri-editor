import { describe, expect, it } from 'vitest';

import type { AttributionMatches, MatchedPassage, Span } from '$lib/ipc';

import {
	classify,
	isStock,
	quotations,
	quotedExactly,
	quotedParts,
	THRESHOLDS,
	verdictOf,
	type CheckedSentence,
	type Thresholds
} from './classify';
import { words } from './normalise';

/**
 * The classifier is mutation-tested (M4-4 AC-3): each rule and each boundary
 * here has a case that fails if it changes. The thresholds' values come from
 * the harness; these tests pin what they mean.
 */

const VASWANI =
	'We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.';
const ADAM =
	'An exponential moving average over the parameters can be used, giving higher weight to more recent parameter values.';

const passage = (
	work: string,
	text: string,
	kind: MatchedPassage['kind'] = 'chunk'
): MatchedPassage => ({
	kind,
	work,
	file: kind === 'chunk' ? work : null,
	id: null,
	page: null,
	pageLabel: null,
	text
});

/** Where `phrase`'s words sit in `text`'s, as a word range. */
function rangeOf(text: string, phrase: string): [number, number] {
	const haystack = words(text);
	const needle = words(phrase);
	for (let i = 0; i + needle.length <= haystack.length; i++) {
		if (needle.every((w, j) => haystack[i + j] === w)) return [i, i + needle.length];
	}
	throw new Error(`"${phrase}" is not in "${text}"`);
}

/** A span of `sentence` sharing `phrase` unbroken with `passages[at]`. */
function span(
	sentenceIndex: number,
	sentence: string,
	at: number,
	source: string,
	phrase: string,
	sources?: number[]
): Span {
	const s = rangeOf(sentence, phrase);
	const p = rangeOf(source, phrase);
	const shared = s[1] - s[0];
	return {
		sentence: sentenceIndex,
		passage: at,
		sentenceWords: s,
		passageWords: p,
		sharedWords: shared,
		verbatimScore: 1,
		sources: sources ?? Array.from({ length: Math.max(1, shared - 5) }, () => 1)
	};
}

const sentence = (text: string, cites: string[] = [], quoted = false): CheckedSentence => ({
	text,
	cites,
	quoted
});

const matches = (spans: Span[], passages: MatchedPassage[]): AttributionMatches => ({
	spans,
	passages,
	read: passages.length,
	sources: new Set(passages.map((p) => p.work)).size,
	documents: 0
});

const kinds = (sentences: CheckedSentence[], m: AttributionMatches, t?: Thresholds) =>
	classify(sentences, m, t).map((f) => [f.sentence, f.kind, f.work]);

describe('a verdict for a sentence', () => {
	// M4-4 AC-1
	it('is its worst finding, wrong source first and reuse last', () => {
		expect(verdictOf([])).toBe('none');
		expect(verdictOf([{ kind: 'self_reuse' }])).toBe('self_reuse');
		expect(verdictOf([{ kind: 'self_reuse' }, { kind: 'uncited' }])).toBe('uncited');
		expect(verdictOf([{ kind: 'uncited' }, { kind: 'drifted_quote' }])).toBe('drifted_quote');
		expect(verdictOf([{ kind: 'drifted_quote' }, { kind: 'wrong_source' }])).toBe('wrong_source');
	});
});

describe('finding quotations', () => {
	const quoted = (text: string) => quotations(text).map(([a, b]) => text.slice(a, b));

	// M4-4 AC-1
	it('finds curly, straight, guillemet and low-high pairs', () => {
		expect(quoted('They wrote “the words here” and left.')).toEqual(['the words here']);
		expect(quoted('They wrote "the words here" and left.')).toEqual(['the words here']);
		expect(quoted('They wrote «the words here» and left.')).toEqual(['the words here']);
		expect(quoted('They wrote „the words here“ and left.')).toEqual(['the words here']);
		expect(quoted('They wrote „the words here” and left.')).toEqual(['the words here']);
	});

	// M4-4 AC-1
	it('finds British single quotation marks, but not apostrophes', () => {
		expect(quoted('Ong calls it ‘secondary orality’ in his book.')).toEqual(['secondary orality']);
		expect(quoted("Ong calls it 'secondary orality' in his book.")).toEqual(['secondary orality']);
		expect(quoted('The model’s output was the authors’ choice.')).toEqual([]);
		expect(quoted("It isn't one and it doesn't close.")).toEqual([]);
		// An apostrophe inside a quotation doesn't close it.
		expect(quoted('He said ‘the model’s output’ was wrong.')).toEqual(['the model’s output']);
	});

	// M4-4 AC-1
	it('finds single marks at the very edges of a sentence, but not after a letter', () => {
		expect(quoted('‘Secondary orality’')).toEqual(['Secondary orality']);
		expect(quoted("'Secondary orality'")).toEqual(['Secondary orality']);
		// A ‘ typed for an apostrophe opens nothing, even after the first letter.
		expect(quoted('the authors‘ claim stands')).toEqual([]);
		expect(quoted('s‘ claim stands')).toEqual([]);
	});

	// M4-4 AC-1
	it('finds several in one sentence', () => {
		expect(quoted('“One,” she said, “and two.”')).toEqual(['One,', 'and two.']);
	});

	// M4-4 AC-1
	it('runs an unclosed quotation to the end, into the next sentence', () => {
		expect(quoted('They wrote “the words run on.')).toEqual(['the words run on.']);
	});

	// M4-4 AC-1
	it('takes the text before a lone closing mark as the end of an earlier quotation', () => {
		expect(quoted('the second sentence ends.” (Smith, 2020)')).toEqual([
			'the second sentence ends.'
		]);
		expect(quoted('the second sentence ends.» Then')).toEqual(['the second sentence ends.']);
		// Only before any quotation of its own, and never a lone ’.
		expect(quoted('“One” and two” three')).toEqual(['One']);
		expect(quoted('the authors’ claim stands.')).toEqual([]);
		// A mark at the very start closes nothing.
		expect(quoted('” stray')).toEqual([]);
	});

	// M4-4 AC-1
	it('finds nothing in a sentence without quotation marks, or between empty ones', () => {
		expect(quotations('')).toEqual([]);
		expect(quotations('He said “” and left.')).toEqual([]);
		expect(quotations('He said “')).toEqual([]);
		expect(quotations('Plain words, nothing quoted.')).toEqual([]);
	});

	// M4-4 AC-1
	it('gives offsets that hold for text outside the basic plane', () => {
		const text = '𝒜 “quoted” 𝒜';
		expect(quotations(text).map(([a, b]) => text.slice(a, b))).toEqual(['quoted']);
	});
});

describe('comparing a quotation with its source', () => {
	// M4-4 AC-1
	it('splits where the writer marked an omission or added words', () => {
		expect(quotedParts('one two … three')).toEqual([['one', 'two'], ['three']]);
		expect(quotedParts('one two ... three')).toEqual([['one', 'two'], ['three']]);
		expect(quotedParts('one two . . . three')).toEqual([['one', 'two'], ['three']]);
		expect(quotedParts('one [the model] two')).toEqual([['one'], ['two']]);
		expect(quotedParts('one […] two')).toEqual([['one'], ['two']]);
		expect(quotedParts('… one')).toEqual([['one']]);
	});

	// M4-4 AC-1
	it('keeps a changed capital in its word', () => {
		expect(quotedParts('[t]he model works')).toEqual([['the', 'model', 'works']]);
	});

	// M4-4 AC-1
	it('requires each part unbroken, in order', () => {
		const source = words('a b c d e f g');
		expect(
			quotedExactly(
				[
					['b', 'c'],
					['e', 'f']
				],
				source
			)
		).toBe(true);
		expect(quotedExactly([['a', 'b', 'c', 'd', 'e', 'f', 'g']], source)).toBe(true);
		expect(
			quotedExactly(
				[
					['e', 'f'],
					['b', 'c']
				],
				source
			)
		).toBe(false);
		expect(quotedExactly([['b', 'd']], source)).toBe(false);
		expect(quotedExactly([['f', 'g', 'h']], source)).toBe(false);
		// The second part starts after the first ends, not inside it.
		expect(
			quotedExactly(
				[
					['b', 'c'],
					['c', 'd']
				],
				source
			)
		).toBe(false);
		expect(quotedExactly([], source)).toBe(false);
	});
});

describe('stock phrasing', () => {
	const t = { ...THRESHOLDS, commonIn: 5, commonShare: 0.5 };

	// M4-4 AC-1
	it('is a span whose shingles are mostly in many sources', () => {
		expect(isStock({ sources: [5, 5, 1, 1] }, t)).toBe(true);
		expect(isStock({ sources: [5, 1, 1, 1] }, t)).toBe(false);
		expect(isStock({ sources: [4, 4, 4, 4] }, t)).toBe(false);
		expect(isStock({ sources: [9, 9, 9, 9] }, t)).toBe(true);
		expect(isStock({ sources: [] }, t)).toBe(false);
	});
});

describe('classifying spans', () => {
	const copied =
		'a new simple network architecture, the Transformer, based solely on attention mechanisms';

	// M4-4 AC-1
	it('reports a source’s words with no citation as uncited', () => {
		const text = `They built ${copied}.`;
		const found = classify(
			[sentence(text)],
			matches([span(0, text, 0, VASWANI, copied)], [passage('vaswani', VASWANI)])
		);

		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ sentence: 0, kind: 'uncited', work: 'vaswani' });
		expect(found[0].passage.text).toBe(VASWANI);
		expect(found[0].span.sharedWords).toBe(12);
	});

	// M4-4 AC-1
	it('reports nothing for words cited to the work they come from, quoted or not', () => {
		const text = `They built ${copied}.`;
		const quotedText = `They built “${copied}”.`;
		const p = [passage('vaswani', VASWANI)];

		expect(
			kinds([sentence(text, ['vaswani'])], matches([span(0, text, 0, VASWANI, copied)], p))
		).toEqual([]);
		expect(
			kinds(
				[sentence(quotedText, ['vaswani'])],
				matches([span(0, quotedText, 0, VASWANI, copied)], p)
			)
		).toEqual([]);
	});

	// M4-4 AC-1
	it('reports words cited to a different work as the wrong source', () => {
		const text = `They built ${copied}.`;
		expect(
			kinds(
				[sentence(text, ['devlin'])],
				matches([span(0, text, 0, VASWANI, copied)], [passage('vaswani', VASWANI)])
			)
		).toEqual([[0, 'wrong_source', 'vaswani']]);
	});

	// M4-4 AC-1
	it('reports nothing against a second work sharing the words the cited one explains', () => {
		const text = `They built ${copied}.`;
		const m = matches(
			[span(0, text, 0, VASWANI, copied), span(0, text, 1, VASWANI, copied)],
			[passage('vaswani', VASWANI), passage('a-survey-quoting-it', VASWANI)]
		);
		expect(kinds([sentence(text, ['vaswani'])], m)).toEqual([]);
	});

	// M4-4 AC-1
	it('reports another work’s words only where the cited work leaves enough unexplained', () => {
		const first = 'a new simple network architecture, the Transformer';
		const rest =
			'based solely on attention mechanisms, dispensing with recurrence and convolutions entirely';
		const text = `They built ${first}, ${rest}.`;
		const m = (other: string) =>
			matches(
				[span(0, text, 0, VASWANI, first), span(0, text, 1, VASWANI, other)],
				[passage('vaswani', VASWANI), passage('other', VASWANI)]
			);

		// Eleven words of the other work's span are beyond what the citation covers.
		expect(kinds([sentence(text, ['vaswani'])], m(`the Transformer, ${rest}`))).toEqual([
			[0, 'wrong_source', 'other']
		]);
		// Two words beyond it are not enough.
		expect(
			kinds(
				[sentence(text, ['vaswani'])],
				m('network architecture, the Transformer, based solely on')
			)
		).toEqual([]);
	});

	// M4-4 AC-2
	it('counts exactly the words the cited work leaves unexplained', () => {
		// Ranges only matter here, so the spans are written out by hand.
		const text = 'w0 w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 w13 w14 w15 w16 w17 w18 w19';
		const p = [passage('cited', text), passage('other', text)];
		const at = (passageIndex: number, range: [number, number]): Span => ({
			sentence: 0,
			passage: passageIndex,
			sentenceWords: range,
			passageWords: range,
			sharedWords: range[1] - range[0],
			verbatimScore: 1,
			sources: [1]
		});
		const floor = { ...THRESHOLDS, minSharedWords: 3 };
		const check = (other: [number, number]) =>
			kinds([sentence(text, ['cited'])], matches([at(0, [5, 10]), at(1, other)], p), floor);

		// Three words after the cited run: enough. Two: not.
		expect(check([5, 13])).toEqual([[0, 'wrong_source', 'other']]);
		expect(check([5, 12])).toEqual([]);
		// The same before it.
		expect(check([2, 10])).toEqual([[0, 'wrong_source', 'other']]);
		expect(check([3, 10])).toEqual([]);
	});

	// M4-4 AC-2
	it('holds a span to the floor by the words it shares, not by its length', () => {
		const text = `They built ${copied}.`;
		const gappy = { ...span(0, text, 0, VASWANI, copied), sharedWords: 7, verbatimScore: 7 / 12 };
		expect(kinds([sentence(text)], matches([gappy], [passage('vaswani', VASWANI)]))).toEqual([]);
	});

	// M4-4 AC-2
	it('reports a span from exactly the floor of shared words, and not one fewer', () => {
		const eight = 'the Transformer, based solely on attention mechanisms, dispensing';
		const seven = 'the Transformer, based solely on attention mechanisms';
		const text = `They built ${copied}, dispensing.`;
		const p = [passage('vaswani', VASWANI)];
		const floor = { ...THRESHOLDS, minSharedWords: 8 };

		expect(kinds([sentence(text)], matches([span(0, text, 0, VASWANI, eight)], p), floor)).toEqual([
			[0, 'uncited', 'vaswani']
		]);
		expect(kinds([sentence(text)], matches([span(0, text, 0, VASWANI, seven)], p), floor)).toEqual(
			[]
		);
	});

	// M4-4 AC-2
	it('uses the chosen thresholds when none are given', () => {
		expect(THRESHOLDS).toEqual({ minSharedWords: 8, commonIn: 5, commonShare: 0.5 });
		const seven = 'the Transformer, based solely on attention mechanisms';
		const text = `They built ${copied}.`;
		expect(
			kinds(
				[sentence(text)],
				matches([span(0, text, 0, VASWANI, seven)], [passage('vaswani', VASWANI)])
			)
		).toEqual([]);
	});

	// M4-4 AC-1
	it('reports nothing for stock phrasing, cited or not', () => {
		const stock = 'in recent years there has been growing interest in';
		const source = `Indeed ${stock} the topic.`;
		const text = `Clearly ${stock} retrieval.`;
		const common = span(0, text, 0, source, stock, [12, 12, 12, 12]);
		const p = [passage('a', source)];

		expect(kinds([sentence(text)], matches([common], p))).toEqual([]);
		expect(kinds([sentence(text, ['b'])], matches([common], p))).toEqual([]);
	});

	// M4-4 AC-1
	it('reports a quotation whose words differ from the cited source as drifted', () => {
		const text =
			'Kingma and Ba note that “an exponential moving average over the parameters can be used, giving more weight to recent parameter values”.';
		const m = matches(
			[
				span(
					0,
					text,
					0,
					ADAM,
					'an exponential moving average over the parameters can be used, giving'
				)
			],
			[passage('adam', ADAM)]
		);

		expect(kinds([sentence(text, ['adam'])], m)).toEqual([[0, 'drifted_quote', 'adam']]);
	});

	// M4-4 AC-1
	it('compares however short the shared run, inside a quotation of the cited work', () => {
		const text = 'They say it is “an exponential moving average over the weights”.';
		const m = matches(
			[span(0, text, 0, ADAM, 'an exponential moving average over the')],
			[passage('adam', ADAM)]
		);
		expect(kinds([sentence(text, ['adam'])], m)).toEqual([[0, 'drifted_quote', 'adam']]);
	});

	// M4-4 AC-1
	it('accepts a quotation with an omission marked, or a changed capital', () => {
		const omitted =
			'They write that “an exponential moving average … can be used, giving higher weight to more recent parameter values”.';
		const capital =
			'“[A]n exponential moving average over the parameters can be used” (Kingma and Ba).';
		const p = [passage('adam', ADAM)];

		expect(
			kinds(
				[sentence(omitted, ['adam'])],
				matches(
					[
						span(
							0,
							omitted,
							0,
							ADAM,
							'can be used, giving higher weight to more recent parameter values'
						)
					],
					p
				)
			)
		).toEqual([]);
		expect(
			kinds(
				[sentence(capital, ['adam'])],
				matches(
					[span(0, capital, 0, ADAM, 'exponential moving average over the parameters can be used')],
					p
				)
			)
		).toEqual([]);
	});

	// M4-4 AC-1
	it('accepts a quotation exact in another passage of the same work', () => {
		// Chunks overlap, so the whole quotation may sit in a neighbour.
		const text = '“An exponential moving average over the parameters can be used” (Kingma and Ba).';
		const cut = 'An exponential moving average over the parameters';
		const m = matches(
			[
				span(0, text, 0, cut, cut),
				span(0, text, 1, ADAM, 'an exponential moving average over the parameters can be used')
			],
			[passage('adam', cut), passage('adam', ADAM)]
		);
		expect(kinds([sentence(text, ['adam'])], m)).toEqual([]);
	});

	// M4-4 AC-1
	it('only compares a quotation the span falls in', () => {
		const text = `They built ${copied}, which they called “a model of its own”.`;
		const m = matches([span(0, text, 0, VASWANI, copied)], [passage('vaswani', VASWANI)]);
		expect(kinds([sentence(text, ['vaswani'])], m)).toEqual([]);
	});

	// M4-4 AC-1
	it('places a quotation by its own words, not the rest of the sentence', () => {
		// The quotation comes first; the copied words after it are cited unquoted.
		const text = `Called “a model of its own”, it was ${copied}.`;
		const m = matches([span(0, text, 0, VASWANI, copied)], [passage('vaswani', VASWANI)]);
		expect(kinds([sentence(text, ['vaswani'])], m)).toEqual([]);
	});

	// M4-4 AC-1
	it('accepts a quotation exact in any work the sentence cites', () => {
		const text =
			'“An exponential moving average over the parameters can be used” (Kingma and Ba; Smith).';
		const near = 'An exponential moving average over the weights can be used.';
		const m = matches(
			[
				span(0, text, 0, near, 'an exponential moving average over the'),
				span(0, text, 1, ADAM, 'an exponential moving average over the parameters can be used')
			],
			[passage('smith', near), passage('adam', ADAM)]
		);
		expect(kinds([sentence(text, ['smith', 'adam'])], m)).toEqual([]);
		// Cited to Smith alone, it differs from Smith's words. Adam's span
		// reaches only five words past what the citation covers, too few to
		// report against Adam as well.
		expect(kinds([sentence(text, ['smith'])], m)).toEqual([[0, 'drifted_quote', 'smith']]);
	});

	// M4-4 AC-1
	it('treats a block quotation as quoted throughout', () => {
		const text =
			'An exponential moving average over the parameters can be used, giving more weight to recent values.';
		const m = matches(
			[
				span(
					0,
					text,
					0,
					ADAM,
					'an exponential moving average over the parameters can be used, giving'
				)
			],
			[passage('adam', ADAM)]
		);
		expect(kinds([sentence(text, ['adam'], true)], m)).toEqual([[0, 'drifted_quote', 'adam']]);
		expect(kinds([sentence(text, ['adam'], false)], m)).toEqual([]);
	});

	// M4-4 AC-1
	it('reports a drifted quotation once per work, however many quotations', () => {
		const source =
			'An exponential moving average over all of the parameters can be used, giving much more weight to recent parameter values.';
		const text =
			'“An exponential moving average over the parameters can be used,” they say, “giving more weight to recent parameter values.”';
		const m = matches(
			[
				span(0, text, 0, source, 'an exponential moving average over'),
				span(0, text, 0, source, 'more weight to recent parameter values')
			],
			[passage('adam', source)]
		);
		expect(kinds([sentence(text, ['adam'])], m)).toEqual([[0, 'drifted_quote', 'adam']]);
	});

	// M4-4 AC-1
	it('reports a quotation with no citation as uncited', () => {
		const text = `They built “${copied}”.`;
		expect(
			kinds(
				[sentence(text)],
				matches([span(0, text, 0, VASWANI, copied)], [passage('vaswani', VASWANI)])
			)
		).toEqual([[0, 'uncited', 'vaswani']]);
	});

	// M4-4 AC-1
	it('reports each uncited work once, by its longest span', () => {
		const other =
			'Dispensing with recurrence and convolutions entirely, the authors built a new simple network architecture.';
		const text = `They built ${copied}, dispensing with recurrence and convolutions entirely.`;
		const found = classify(
			[sentence(text)],
			matches(
				[
					span(
						0,
						text,
						0,
						VASWANI,
						'a new simple network architecture, the Transformer, based solely'
					),
					span(0, text, 1, VASWANI, copied),
					span(
						0,
						text,
						2,
						other,
						'dispensing with recurrence and convolutions entirely',
						[1, 1, 1, 1, 1, 1, 1, 1]
					)
				],
				[passage('vaswani', VASWANI), passage('vaswani', VASWANI), passage('other', other)]
			),
			{ ...THRESHOLDS, minSharedWords: 6 }
		);

		expect(found.map((f) => [f.kind, f.work, f.span.passage])).toEqual([
			['uncited', 'vaswani', 1],
			['uncited', 'other', 2]
		]);
	});

	// M4-4 AC-1
	it('keeps the first of two equally long spans', () => {
		const text = `They built ${copied}.`;
		const found = classify(
			[sentence(text)],
			matches(
				[span(0, text, 0, VASWANI, copied), span(0, text, 1, VASWANI, copied)],
				[passage('vaswani', VASWANI), passage('vaswani', VASWANI)]
			)
		);
		expect(found.map((f) => f.span.passage)).toEqual([0]);
	});

	// M4-4 AC-1
	it('reports reuse of the writer’s other documents only where no source matches', () => {
		const chapter =
			'Retrieval systems have always encoded a view of what their users need, in every era.';
		const own = 'Retrieval systems have always encoded a view of what their users need';
		const text = `${own}.`;
		const doc = passage('chapter-2.erti.json', chapter, 'document');

		expect(kinds([sentence(text)], matches([span(0, text, 0, chapter, own)], [doc]))).toEqual([
			[0, 'self_reuse', 'chapter-2.erti.json']
		]);

		// The same words in a source: the source is what's reported.
		const both = matches(
			[span(0, text, 0, chapter, own), span(0, text, 1, chapter, own)],
			[doc, passage('a-paper', chapter)]
		);
		expect(kinds([sentence(text)], both)).toEqual([[0, 'uncited', 'a-paper']]);
		expect(kinds([sentence(text, ['a-paper'])], both)).toEqual([]);
	});

	// M4-4 AC-1
	it('still reports reuse when a source shares only a few of the words', () => {
		const own =
			'Retrieval systems have always encoded a view of what their users need, and rarely say so';
		const text = `${own}.`;
		// Six of its words in a paper: too few to report, and far from all of it.
		const six = 'a view of what their users';
		const paper = 'Designers take a view of what their users want from a catalogue.';
		const found = matches(
			[span(0, text, 0, own, own), span(0, text, 1, paper, six)],
			[passage('ch2', own, 'document'), passage('a-paper', paper)]
		);
		expect(kinds([sentence(text)], found)).toEqual([[0, 'self_reuse', 'ch2']]);
	});

	// M4-4 AC-2
	it('holds reuse to the floor of shared words, not the words it spans', () => {
		const chapter = 'Retrieval systems have always encoded a view of what their users need.';
		const text = 'Retrieval systems have always encoded a view of what they need.';
		// Nine words spanned, seven of them shared: a word changed between runs.
		const loose: Span = {
			...span(0, text, 0, chapter, 'retrieval systems have always encoded a view'),
			sentenceWords: [0, 9],
			sharedWords: 7,
			verbatimScore: 7 / 9
		};
		expect(
			kinds([sentence(text)], matches([loose], [passage('ch2', chapter, 'document')]))
		).toEqual([]);
	});

	// M4-4 AC-2
	it('reports reuse from exactly the floor of shared words', () => {
		const chapter = 'Retrieval systems have always encoded a view of what their users need.';
		const eight = 'retrieval systems have always encoded a view of';
		const text = 'Retrieval systems have always encoded a view of the past, I argued.';
		expect(
			kinds(
				[sentence(text)],
				matches([span(0, text, 0, chapter, eight)], [passage('ch2', chapter, 'document')])
			)
		).toEqual([[0, 'self_reuse', 'ch2']]);
	});

	// M4-4 AC-2
	it('holds reuse to the same floor of shared words', () => {
		const chapter = 'Retrieval systems have always encoded a view of what their users need.';
		const short = 'retrieval systems have always encoded a view';
		const text = 'Retrieval systems have always encoded a view, as I argued.';
		expect(
			kinds(
				[sentence(text)],
				matches([span(0, text, 0, chapter, short)], [passage('ch2', chapter, 'document')])
			)
		).toEqual([]);
	});

	// M4-4 AC-1
	it('gives findings in sentence order, and skips a span naming no sentence', () => {
		const text = `They built ${copied}.`;
		const p = [passage('vaswani', VASWANI)];
		const found = classify(
			[sentence(text), sentence(text)],
			matches(
				[
					span(1, text, 0, VASWANI, copied),
					span(0, text, 0, VASWANI, copied),
					span(5, text, 0, VASWANI, copied)
				],
				p
			)
		);
		expect(found.map((f) => f.sentence)).toEqual([0, 1]);
	});

	// M4-4 AC-1
	it('reports nothing when nothing matched', () => {
		expect(classify([sentence('Anything at all.')], matches([], []))).toEqual([]);
	});
});
