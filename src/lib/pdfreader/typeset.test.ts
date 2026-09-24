import { describe, expect, it } from 'vitest';

import { ASCENT, DESCENT, bandFor, bandOf, lineFor, snapToLines } from './typeset';

/** A line of 10pt type with its baseline at y, running from x to right. */
const line = (y: number, x = 20, right = 400) => ({ y, fontSize: 10, x, right });

/**
 * What a browser hands back for a selection.
 *
 * pdf.js sizes each text-layer span from the real font, so the rectangle is that
 * font's reserved ascent and descent about the baseline. These are Times, which
 * is what most papers are set in: 0.891 above, 0.216 below.
 */
const spanRect = (baseline: number, x = 40, w = 120, size = 10, ascent = 0.891) => ({
	x,
	w,
	y: baseline - 0.216 * size,
	h: (ascent + 0.216) * size
});

/** The old name, kept where a test only cares that the baseline is inside. */
const looseRect = spanRect;

describe('the band letters occupy', () => {
	it('sits below the baseline by the descent and above it by the ascent', () => {
		expect(bandOf(line(700))).toEqual({
			bottom: 700 - DESCENT * 10,
			height: (ASCENT + DESCENT) * 10
		});
	});

	it('scales with the type, so a heading gets a taller band than a footnote', () => {
		const heading = bandOf({ y: 700, fontSize: 24, x: 0, right: 100 });
		const footnote = bandOf({ y: 700, fontSize: 7, x: 0, right: 100 });

		expect(heading.height).toBeGreaterThan(footnote.height);
	});
});

it('sits on the ink rather than on the em box', () => {
	// Measured with a canvas: real text in Times puts ink from 0.216em below
	// the baseline to 0.695em above it, Helvetica 0.221/0.728. A band has to
	// cover that with a little air, and — this is the part that was wrong —
	// with the air shared between top and bottom rather than piled above.
	const band = bandOf(line(700));
	const above = band.bottom + band.height - 700;
	const below = 700 - band.bottom;

	// Clears the descenders of every face measured.
	expect(below).toBeGreaterThan(0.221 * 10);
	// Clears the capitals of a paper set in Times, without floating above them.
	expect(above).toBeGreaterThan(0.695 * 10);
	expect(above).toBeLessThan(0.76 * 10);
});

it('shares its slack between the top and the bottom', () => {
	// The reported fault: all of the slack was above the letters, so the band
	// looked like it had ridden up off the line.
	const band = bandOf(line(700));
	const airAbove = band.bottom + band.height - 700 - 0.695 * 10;
	const airBelow = 700 - band.bottom - 0.216 * 10;

	expect(Math.abs(airAbove - airBelow)).toBeLessThan(0.03 * 10);
});

describe('finding the line a rectangle covers', () => {
	it('takes the line whose baseline is inside it', () => {
		const lines = [line(740), line(700), line(660)];

		expect(lineFor(looseRect(700), lines)).toBe(lines[1]);
	});

	it('ignores a line in another column, however close in y', () => {
		// Two columns share every baseline on the page, so y alone names both.
		const left = line(700, 20, 280);
		const right = line(700, 320, 580);

		expect(lineFor(looseRect(700, 330, 100), [left, right])).toBe(right);
	});

	it('takes the nearer baseline when a tall box swallows two', () => {
		const upper = line(706);
		const lower = line(694);
		const box = { x: 40, w: 120, y: 690, h: 20 };

		// Centre is 700; 706 and 694 are equidistant, so the first wins — what
		// matters is that it is one of them and not a merge of both.
		expect([upper, lower]).toContain(lineFor(box, [upper, lower]));
	});

	it('says nothing for a rectangle over a figure, where there are no baselines', () => {
		expect(lineFor(looseRect(700), [line(400)])).toBeNull();
	});
});

describe("following the document's own font", () => {
	it('takes its ascent from the rectangle, not from a constant', () => {
		// The whole reason this generalises: pdf.js sizes every span from the real
		// font, so the rectangle *is* that font's metrics. A face that reserves
		// more ascent gets a taller band without anything being hardcoded for it.
		const tight = bandFor(spanRect(700, 40, 120, 10, 0.86), line(700));
		const airy = bandFor(spanRect(700, 40, 120, 10, 1.02), line(700));

		expect(airy.height).toBeGreaterThan(tight.height);
	});

	it('keeps the descenders whatever the font reserves for them', () => {
		// A descender is inked to its full depth — that is what a descender is —
		// so the bottom follows the font exactly rather than a share of it.
		const rect = { x: 40, w: 120, y: 700 - 0.28 * 10, h: (0.9 + 0.28) * 10 };
		const band = bandFor(rect, line(700));

		expect(band.bottom).toBeCloseTo(700 - 0.28 * 10, 3);
	});

	it('falls back to the measured constants for a rectangle that is not a line', () => {
		// A rectangle that does not contain its own baseline is a merge of several
		// lines, or a range that collapsed. Reading metrics off it would give a
		// band the height of a paragraph.
		const wrong = { x: 40, w: 120, y: 720, h: 40 };
		const band = bandFor(wrong, line(700));

		expect(band.bottom).toBeCloseTo(700 - DESCENT * 10, 3);
		expect(band.height).toBeCloseTo((ASCENT + DESCENT) * 10, 3);
	});

	it('will not let a paragraph-sized rectangle produce a paragraph-sized band', () => {
		// Bounded, so no rectangle can give an absurd answer.
		const paragraph = { x: 40, w: 120, y: 700 - 30, h: 90 };
		const band = bandFor(paragraph, line(700));

		expect(band.height).toBeLessThan(1.3 * 10);
	});
});

describe('snapping a mark onto the words', () => {
	it('replaces the vertical extent and keeps the horizontal', () => {
		const rect = spanRect(700, 40, 120);
		const [snapped] = snapToLines([rect], [line(700)]);

		expect(snapped.x).toBe(40);
		expect(snapped.w).toBe(120);
		// Below the baseline by the font's own descent, and above it by the share
		// of the font's own ascent that carries ink.
		expect(snapped.y).toBeCloseTo(700 - 0.216 * 10, 3);
		expect(snapped.y + snapped.h).toBeCloseTo(700 + 0.8 * 0.891 * 10, 3);
	});

	it('puts the foot of the mark below the baseline, so an underline is a rule', () => {
		// The reported fault: an underline drawn at the foot of a browser's line
		// box landed on the baseline and read as a strikethrough.
		const [snapped] = snapToLines([looseRect(700)], [line(700)]);

		expect(snapped.y).toBeLessThan(700);
	});

	it('leaves a rectangle alone when its line cannot be told', () => {
		const rect = looseRect(700);

		expect(snapToLines([rect], [line(300)])).toEqual([rect]);
	});

	it('leaves everything alone on a page with no text at all', () => {
		const rects = [looseRect(700), looseRect(680)];

		expect(snapToLines(rects, [])).toEqual(rects);
	});

	it('snaps each line of a passage that wraps to its own line', () => {
		const snapped = snapToLines([spanRect(700), spanRect(686)], [line(700), line(686)]);

		expect(snapped[0].y).toBeCloseTo(700 - 0.216 * 10, 3);
		expect(snapped[1].y).toBeCloseTo(686 - 0.216 * 10, 3);
	});
});
