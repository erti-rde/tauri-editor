import { describe, expect, it } from 'vitest';

import {
	candidatesFromPage,
	collectImportable,
	importKey,
	isImportable,
	nearestLabel,
	quadPointsToRects,
	quoteFromLines,
	rectToBox
} from './importAnnotations';

import type { Line } from '$lib/ingest/extract';

/**
 * Bringing in someone else's marks. The risks are all one-sided: guessing wrong
 * puts words in a researcher's mouth, and importing twice quietly doubles their
 * library. Leaving something out is recoverable; neither of those is.
 */

const labels = [
	{ id: 'claim', colour: '45 95% 62%', enabled: true },
	{ id: 'evidence', colour: '145 50% 55%', enabled: true },
	{ id: 'method', colour: '210 80% 65%', enabled: true },
	{ id: 'limitation', colour: '5 80% 66%', enabled: true },
	{ id: 'retired', colour: '280 50% 68%', enabled: false }
];

function line(text: string, x: number, y: number, right: number): Line {
	return { text, x, y, right, fontSize: 10, fontName: 'F1', page: 1 };
}

describe('deciding what to bring in', () => {
	it('takes the marks that carry meaning', () => {
		for (const subtype of ['Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Text', 'FreeText']) {
			expect(isImportable({ subtype })).toBe(true);
		}
	});

	it('leaves the rest of a PDF alone', () => {
		// Form fields, links and stamps are not somebody's reading.
		for (const subtype of ['Link', 'Widget', 'Popup', 'Stamp', undefined]) {
			expect(isImportable({ subtype })).toBe(false);
		}
	});
});

describe('reading where a mark is', () => {
	it('turns a quad into a rectangle', () => {
		// Upper-left first, as Acrobat writes them.
		const rects = quadPointsToRects([10, 112, 210, 112, 10, 100, 210, 100]);

		expect(rects).toEqual([{ x: 10, y: 100, w: 200, h: 12 }]);
	});

	it('reads a producer that writes the corners the other way round', () => {
		// The specification's order is not universally followed, and taking the
		// extremes of all four points means it does not have to be.
		const rects = quadPointsToRects([10, 100, 210, 100, 10, 112, 210, 112]);

		expect(rects).toEqual([{ x: 10, y: 100, w: 200, h: 12 }]);
	});

	it('joins the quads of one highlighted line', () => {
		const rects = quadPointsToRects([
			10, 112, 110, 112, 10, 100, 110, 100, 110, 112, 210, 112, 110, 100, 210, 100
		]);

		expect(rects).toHaveLength(1);
		expect(rects[0].w).toBe(200);
	});

	it('keeps two separate lines separate', () => {
		const rects = quadPointsToRects([
			10, 112, 210, 112, 10, 100, 210, 100, 10, 92, 210, 92, 10, 80, 210, 80
		]);

		expect(rects).toHaveLength(2);
	});

	it('falls back to a note icon’s own rectangle', () => {
		// A sticky note has no quads; it has a position.
		expect(rectToBox([10, 100, 30, 120])).toEqual([{ x: 10, y: 100, w: 20, h: 20 }]);
	});

	it('has nothing to say about missing or malformed geometry', () => {
		expect(quadPointsToRects(null)).toEqual([]);
		expect(quadPointsToRects([1, 2, 3])).toEqual([]);
		expect(rectToBox(undefined)).toEqual([]);
	});
});

describe('guessing what a colour meant', () => {
	it('matches a yellow highlight to the yellow label', () => {
		expect(nearestLabel([255, 235, 100], labels)).toBe('claim');
	});

	it('matches a green one to the green label', () => {
		expect(nearestLabel([80, 200, 120], labels)).toBe('evidence');
	});

	it('treats red as red across the wrap-around', () => {
		// Hue 355 and hue 5 are the same colour to a reader, and a naive distance
		// would call them 350 apart.
		expect(nearestLabel([255, 60, 70], labels)).toBe('limitation');
	});

	it('refuses to guess when nothing is close', () => {
		// A wrong label puts a meaning on a passage that the reader never gave it,
		// which is worse than leaving it unlabelled.
		expect(
			nearestLabel([120, 255, 255], [{ id: 'only', colour: '45 95% 62%', enabled: true }])
		).toBe(null);
	});

	it('never picks a label that is switched off', () => {
		expect(nearestLabel([200, 120, 230], labels)).not.toBe('retired');
	});

	it('leaves a grey or colourless mark unlabelled', () => {
		expect(nearestLabel([128, 128, 128], labels)).toBeNull();
		expect(nearestLabel(null, labels)).toBeNull();
	});
});

describe('recovering the words', () => {
	const lines = [
		line('the effect was strongest in the treated group', 10, 100, 210),
		line('but the sample was small', 10, 80, 150),
		line('elsewhere on the page', 300, 400, 400)
	];

	it('reads back what a highlight was drawn over', () => {
		// The PDF records where the mark is, never what it says — so without this
		// an imported highlight is a coloured box, invisible to any search.
		const quote = quoteFromLines(lines, [{ x: 10, y: 100, w: 200, h: 12 }]);

		expect(quote).toBe('the effect was strongest in the treated group');
	});

	it('reads a mark spanning two lines', () => {
		const quote = quoteFromLines(lines, [{ x: 10, y: 80, w: 200, h: 32 }]);

		expect(quote).toBe('the effect was strongest in the treated group but the sample was small');
	});

	it('does not pick up text elsewhere on the page', () => {
		const quote = quoteFromLines(lines, [{ x: 10, y: 100, w: 200, h: 12 }]);

		expect(quote).not.toContain('elsewhere');
	});
});

describe('not importing the same mark twice', () => {
	it('gives the same mark the same key', () => {
		const rects = [{ x: 10.0001, y: 100.0002, w: 200, h: 12 }];

		expect(importKey('sha', 4, rects)).toBe(
			importKey('sha', 4, [{ x: 10, y: 100, w: 200, h: 12 }])
		);
	});

	it('tells two marks on the same page apart', () => {
		expect(importKey('sha', 4, [{ x: 10, y: 100, w: 200, h: 12 }])).not.toBe(
			importKey('sha', 4, [{ x: 10, y: 200, w: 200, h: 12 }])
		);
	});

	it('tells the same position on two pages apart', () => {
		const rects = [{ x: 10, y: 100, w: 200, h: 12 }];

		expect(importKey('sha', 4, rects)).not.toBe(importKey('sha', 5, rects));
	});
});

describe('a page of somebody else’s marks', () => {
	const lines = [line('the effect was strongest', 10, 100, 210)];

	it('brings across the mark, its words, its note and its colour', () => {
		const found = candidatesFromPage(
			'sha',
			4,
			[
				{
					subtype: 'Highlight',
					quadPoints: [10, 112, 210, 112, 10, 100, 210, 100],
					contents: 'check this against Jones',
					color: [255, 235, 100]
				}
			],
			lines,
			labels
		);

		expect(found).toHaveLength(1);
		expect(found[0].quote).toBe('the effect was strongest');
		expect(found[0].note).toBe('check this against Jones');
		expect(found[0].labelId).toBe('claim');
		expect(found[0].page).toBe(4);
	});

	it('skips a mark with neither words nor a note', () => {
		// A stray highlight over a blank part of a page is noise, not a note.
		const found = candidatesFromPage(
			'sha',
			4,
			[{ subtype: 'Highlight', quadPoints: [500, 512, 600, 512, 500, 500, 600, 500] }],
			lines,
			labels
		);

		expect(found).toEqual([]);
	});

	it('keeps a sticky note that has something to say but covers no text', () => {
		const found = candidatesFromPage(
			'sha',
			4,
			[{ subtype: 'Text', rect: [500, 500, 520, 520], contents: 'come back to this' }],
			lines,
			labels
		);

		expect(found).toHaveLength(1);
		expect(found[0].note).toBe('come back to this');
	});

	it('ignores links and form fields', () => {
		const found = candidatesFromPage(
			'sha',
			4,
			[{ subtype: 'Link', rect: [10, 100, 210, 112] }],
			lines,
			labels
		);

		expect(found).toEqual([]);
	});
});

describe('walking a document for marks to offer', () => {
	const lines = [line('the effect was strongest', 10, 100, 210)];
	const highlight = {
		subtype: 'Highlight',
		quadPoints: [10, 112, 210, 112, 10, 100, 210, 100],
		color: [255, 235, 100]
	};

	it('finds marks across pages', async () => {
		const found = await collectImportable(
			'sha',
			3,
			async (page) => (page === 2 ? [highlight] : []),
			async () => lines,
			labels
		);

		expect(found).toHaveLength(1);
		expect(found[0].page).toBe(2);
	});

	it('only reads the text of pages that carry marks', async () => {
		// Extracting every page of a thesis to find highlights on four of them is
		// the difference between an offer that appears and one that hangs.
		const read: number[] = [];

		await collectImportable(
			'sha',
			200,
			async (page) => (page === 7 ? [highlight] : []),
			async (page) => {
				read.push(page);
				return lines;
			},
			labels
		);

		expect(read).toEqual([7]);
	});

	it('leaves out marks that have already been imported', async () => {
		// Re-scanning a folder happens whenever a PDF is added, and without this
		// every scan would lay another copy over the last.
		const first = await collectImportable(
			'sha',
			1,
			async () => [highlight],
			async () => lines,
			labels
		);
		const again = await collectImportable(
			'sha',
			1,
			async () => [highlight],
			async () => lines,
			labels,
			new Set(first.map((c) => c.key))
		);

		expect(first).toHaveLength(1);
		expect(again).toEqual([]);
	});

	it('carries on past a page it cannot read', async () => {
		const found = await collectImportable(
			'sha',
			3,
			async (page) => {
				if (page === 1) throw new Error('damaged page');
				return [highlight];
			},
			async () => lines,
			labels
		);

		expect(found.map((c) => c.page)).toEqual([2, 3]);
	});

	it('still keeps a mark when the page text cannot be read', async () => {
		// Without words it is weaker — but the rectangles still draw, and a note
		// attached to it still says what the reader thought.
		const found = await collectImportable(
			'sha',
			1,
			async () => [{ ...highlight, contents: 'important' }],
			async () => {
				throw new Error('no text');
			},
			labels
		);

		expect(found).toHaveLength(1);
		expect(found[0].quote).toBe('');
		expect(found[0].note).toBe('important');
	});
});
