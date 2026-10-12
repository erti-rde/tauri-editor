import { describe, expect, it } from 'vitest';

import { manuscriptParagraphs, matchSpans } from './fakeMatcher';

/**
 * The fake's matcher against the cases `attribution::matcher` is tested on,
 * with the same numbers, so a journey sees the spans the app would. The
 * harness also compares the two on the whole labelled set
 * (`pnpm eval:attribution`).
 */

const ORIGINAL =
	'We propose a new simple network architecture, the Transformer, based solely on attention ' +
	'mechanisms, dispensing with recurrence and convolutions entirely.';

describe('the fake matcher agrees with the Rust one', () => {
	// M4-3 AC-2
	it('finds a sentence copied from a passage', () => {
		const spans = matchSpans(
			[
				'Unrelated opening words here.',
				'They proposed a new simple network architecture, the Transformer, based solely on attention mechanisms.'
			],
			[
				{ source: 'paper-a', text: ORIGINAL },
				{ source: 'paper-b', text: 'Nothing in common with the manuscript at all, at all.' }
			]
		);

		expect(spans).toHaveLength(1);
		expect(spans[0]).toMatchObject({
			sentence: 1,
			passage: 0,
			sentenceWords: [2, 14],
			passageWords: [2, 14],
			sharedWords: 12,
			verbatimScore: 1
		});
	});

	// M4-3 AC-2
	it('counts frequency by source, deduplicating one source’s overlapping chunks', () => {
		const stock = 'in recent years there has been growing interest';
		const spans = matchSpans(
			[stock],
			[
				{ source: 'a', text: stock },
				{ source: 'b', text: stock },
				{ source: 'c', text: stock },
				{ source: 'c', text: `${stock} once more` },
				{ source: 'd', text: 'words that share nothing with the manuscript sentence above' }
			]
		);

		expect(spans).toHaveLength(3);
		for (const span of spans) expect(span.sources).toEqual([3, 3, 3]);
	});

	// M4-3 AC-3
	it('collapses runs either side of a changed word into one span', () => {
		const quoted =
			'superior in quality while being more parallelizable and requiring significantly less time to train than any model before them';
		const drifted =
			'superior in quality while being more parallelizable and requiring far less time to train than any model before them';
		const spans = matchSpans([drifted], [{ source: 'paper-a', text: quoted }]);

		expect(spans).toHaveLength(1);
		expect(spans[0].sentenceWords).toEqual([0, 19]);
		expect(spans[0].sharedWords).toBe(18);
	});

	// M4-3 AC-3
	it('keeps two separate borrowings in one sentence apart', () => {
		const sentence =
			'the encoder maps an input sequence of symbol representations and then for a long while we talk about something else entirely before the decoder then generates an output sequence of symbols';
		const passage =
			'the encoder maps an input sequence of symbol representations to a sequence of continuous representations given z the decoder then generates an output sequence of symbols one element at a time';
		expect(matchSpans([sentence], [{ source: 'paper-a', text: passage }])).toHaveLength(2);
	});
});

describe('reading another manuscript', () => {
	// M4-3 AC-2
	it('reads its paragraphs without its apparatus, as Rust does', () => {
		const para = (content: unknown[]) => ({ type: 'paragraph', content });
		const doc = {
			type: 'doc',
			content: [
				{ type: 'heading', content: [{ type: 'text', text: 'Chapter one' }] },
				para([
					{ type: 'text', text: 'Indexes encode a view ' },
					{ type: 'citation', attrs: { id: '["a"]' } },
					{ type: 'text', text: 'of their users.' },
					{ type: 'hardBreak' },
					{ type: 'text', text: 'A second line.' }
				]),
				{ type: 'codeBlock', content: [{ type: 'text', text: 'x = 1' }] },
				{ type: 'notes', attrs: { notes: [{ text: 'A note.' }] } },
				{ type: 'bibliography', attrs: { entries: ['Smith (2020).'] } }
			]
		};

		expect(manuscriptParagraphs(doc)).toEqual([
			'Chapter one',
			'Indexes encode a view of their users. A second line.'
		]);
		expect(manuscriptParagraphs(null)).toEqual([]);
	});
});
