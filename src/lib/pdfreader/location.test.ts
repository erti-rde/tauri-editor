import { describe, expect, it } from 'vitest';

import {
	applyTransform,
	boundingRect,
	clientRectsToPdf,
	contextAround,
	invertTransform,
	locateQuote,
	mergeRects,
	normaliseWhitespace,
	pdfRectsToClient,
	rectToView,
	toContentSpace,
	viewRectToPdf,
	type Rect
} from './location';

/**
 * The two anchors fail in different ways, so they are tested for different
 * things: the geometry for surviving zoom and rotation without drifting, and
 * the matching for finding the right one of several similar passages.
 */

/**
 * A pdf.js viewport transform at the given scale.
 *
 * pdf.js builds this as [scale, 0, 0, -scale, 0, height*scale] for an unrotated
 * page: the negative d is the y-flip, since PDF y grows upward and CSS y grows
 * downward.
 */
function viewport(scale: number, pageHeight = 800) {
	return { transform: [scale, 0, 0, -scale, 0, pageHeight * scale] };
}

/** A 90-degree rotation, to prove the corner handling is not accidental. */
function rotated(scale: number, pageWidth = 600) {
	return { transform: [0, scale, scale, 0, 0, 0, pageWidth].slice(0, 6) };
}

describe('viewport geometry', () => {
	it('flips the y axis, because PDF and CSS disagree about which way is up', () => {
		// A 100-tall box sitting 700 from the bottom of an 800-tall page is
		// 0 from the top.
		const view = rectToView({ x: 10, y: 700, w: 200, h: 100 }, viewport(1));

		expect(view).toEqual({ left: 10, top: 0, width: 200, height: 100 });
	});

	it('scales with the zoom', () => {
		const view = rectToView({ x: 10, y: 700, w: 200, h: 100 }, viewport(2));

		expect(view).toEqual({ left: 20, top: 0, width: 400, height: 200 });
	});

	it('keeps a rectangle positive under rotation', () => {
		// Rotation sends the top-left corner somewhere that is no longer top-left.
		// Taking the min and the absolute size is what stops a rotated page
		// producing negative widths, which render as nothing at all.
		const view = rectToView({ x: 10, y: 20, w: 30, h: 40 }, rotated(1));

		expect(view.width).toBeGreaterThan(0);
		expect(view.height).toBeGreaterThan(0);
	});

	it('round-trips through the inverse, so zoom does not accumulate drift', () => {
		const original: Rect = { x: 72.5, y: 613.25, w: 431.75, h: 12.5 };

		for (const scale of [0.5, 1, 1.5, 4]) {
			const back = viewRectToPdf(rectToView(original, viewport(scale)), viewport(scale));

			expect(back.x).toBeCloseTo(original.x, 6);
			expect(back.y).toBeCloseTo(original.y, 6);
			expect(back.w).toBeCloseTo(original.w, 6);
			expect(back.h).toBeCloseTo(original.h, 6);
		}
	});

	it('refuses a degenerate matrix rather than returning silent nonsense', () => {
		expect(() => invertTransform([0, 0, 0, 0, 0, 0])).toThrow(/not invertible/);
	});

	it('applies a translation', () => {
		expect(applyTransform(1, 2, [1, 0, 0, 1, 10, 20])).toEqual([11, 22]);
	});
});

describe('merging selection rectangles', () => {
	it('joins the runs a single line arrives in', () => {
		// getClientRects emits one rectangle per text run, so one sentence in a
		// mixed font comes back in pieces that should be drawn as one bar.
		const merged = mergeRects([
			{ x: 10, y: 700, w: 50, h: 12 },
			{ x: 60, y: 700, w: 40, h: 12 },
			{ x: 100, y: 700, w: 30, h: 12 }
		]);

		expect(merged).toEqual([{ x: 10, y: 700, w: 120, h: 12 }]);
	});

	it('keeps separate lines separate', () => {
		const merged = mergeRects([
			{ x: 10, y: 700, w: 100, h: 12 },
			{ x: 10, y: 680, w: 100, h: 12 }
		]);

		expect(merged).toHaveLength(2);
	});

	it('drops the zero-width slivers between runs', () => {
		const merged = mergeRects([
			{ x: 10, y: 700, w: 50, h: 12 },
			{ x: 60, y: 700, w: 0, h: 12 },
			{ x: 60, y: 700, w: 40, h: 12 }
		]);

		expect(merged).toEqual([{ x: 10, y: 700, w: 90, h: 12 }]);
	});

	it('tolerates the sub-pixel gap between adjacent runs', () => {
		// Neighbouring runs rarely abut exactly. Without a tolerance every word
		// would stay its own rectangle and the highlight would look striped.
		const merged = mergeRects([
			{ x: 10, y: 700, w: 50, h: 12 },
			{ x: 60.7, y: 700, w: 40, h: 12 }
		]);

		expect(merged).toHaveLength(1);
	});

	it('groups lines whose baselines differ slightly', () => {
		// A superscript or inline maths shifts the rectangle without starting a
		// new line, so overlap decides, not equality.
		const merged = mergeRects([
			{ x: 10, y: 700, w: 50, h: 12 },
			{ x: 60, y: 702, w: 20, h: 8 }
		]);

		expect(merged).toHaveLength(1);
	});

	it('returns them in reading order, top of the page first', () => {
		const merged = mergeRects([
			{ x: 10, y: 600, w: 100, h: 12 },
			{ x: 10, y: 700, w: 100, h: 12 }
		]);

		expect(merged.map((r) => r.y)).toEqual([700, 600]);
	});

	it('has nothing to say about an empty selection', () => {
		expect(mergeRects([])).toEqual([]);
		expect(boundingRect([])).toBeNull();
	});

	it('bounds a multi-line highlight', () => {
		const bounds = boundingRect([
			{ x: 10, y: 700, w: 100, h: 12 },
			{ x: 20, y: 680, w: 120, h: 12 }
		]);

		expect(bounds).toEqual({ x: 10, y: 680, w: 130, h: 32 });
	});
});

describe('normalising whitespace', () => {
	it('collapses runs and drops the edges', () => {
		expect(normaliseWhitespace('  the   observed \n effect  ').text).toBe('the observed effect');
	});

	it('maps every normalised character back to where it came from', () => {
		const source = 'a  b';
		const { text, map } = normaliseWhitespace(source);

		expect(text).toBe('a b');
		expect(map).toHaveLength(text.length);
		expect(source[map[0]]).toBe('a');
		expect(source[map[2]]).toBe('b');
	});

	it('handles a string that is only whitespace', () => {
		expect(normaliseWhitespace('   \n  ').text).toBe('');
	});
});

describe('finding a quote again', () => {
	const page =
		'We found that the effect was strongest in the treated group. ' +
		'Later work disagreed: the effect was strongest in the control group.';

	it('finds an unambiguous quote and reports original offsets', () => {
		const found = locateQuote(page, { quote: 'Later work disagreed' });

		expect(found).not.toBeNull();
		expect(page.slice(found!.start, found!.end)).toBe('Later work disagreed');
	});

	it('ignores whitespace differences between the two sides', () => {
		// The selection carries pdf.js's run boundaries; the page text is
		// reconstructed from glyph geometry. They genuinely disagree here, and
		// only here.
		const found = locateQuote(page, { quote: 'the  effect\nwas   strongest' });

		expect(found).not.toBeNull();
		expect(page.slice(found!.start, found!.end)).toBe('the effect was strongest');
	});

	it('uses the prefix to pick between identical passages', () => {
		const found = locateQuote(page, {
			quote: 'the effect was strongest',
			prefix: 'Later work disagreed: '
		});

		expect(found).not.toBeNull();
		// The second occurrence, not the first — which is what a naive indexOf
		// would have returned.
		expect(found!.start).toBeGreaterThan(page.indexOf('Later'));
	});

	it('uses the suffix when the prefix cannot separate them', () => {
		const found = locateQuote(page, {
			quote: 'the effect was strongest',
			suffix: ' in the control group.'
		});

		expect(page.slice(found!.end, found!.end + 21)).toBe(' in the control group');
	});

	it('still picks the closer one when the context is no help at all', () => {
		const repeated = 'Table 1 shows it. Table 1 shows it.';
		const found = locateQuote(repeated, { quote: 'Table 1' }, 18);

		expect(found!.start).toBe(18);
	});

	it('takes partial context credit rather than demanding an exact match', () => {
		// Reformatting changes the text around a passage more often than the
		// passage itself. Ten agreeing characters should still beat none.
		const found = locateQuote(page, {
			quote: 'the effect was strongest',
			prefix: 'work disagreed: '
		});

		expect(found!.start).toBeGreaterThan(page.indexOf('Later'));
	});

	it('says so when the quote is simply not there', () => {
		// A real answer, not a failure: the caller falls back to the stored
		// rectangles rather than highlighting the wrong sentence.
		expect(locateQuote(page, { quote: 'a sentence from a different paper' })).toBeNull();
	});

	it('says so for an empty quote', () => {
		expect(locateQuote(page, { quote: '   ' })).toBeNull();
	});
});

describe('capturing context', () => {
	it('takes the text either side', () => {
		const text = 'x'.repeat(50) + 'QUOTE' + 'y'.repeat(50);
		const selector = contextAround(text, 50, 55);

		expect(selector.quote).toBe('QUOTE');
		expect(selector.prefix).toBe('x'.repeat(32));
		expect(selector.suffix).toBe('y'.repeat(32));
	});

	it('does not run off the ends of the page', () => {
		const selector = contextAround('short', 0, 5);

		expect(selector.prefix).toBe('');
		expect(selector.suffix).toBe('');
	});

	it('produces a selector that finds the passage it came from', () => {
		const text = 'The effect held. The effect held. The effect held.';
		const selector = contextAround(text, 17, 33);

		expect(locateQuote(text, selector)!.start).toBe(17);
	});
});

describe('turning a selection into something storable', () => {
	/** A page 100 from the left, 200 from the top of the window, at `scale`. */
	function frameAt(scale: number, page = 1) {
		const height = 800;
		return {
			page,
			bounds: { left: 100, top: 200, width: 595 * scale, height: height * scale },
			viewport: { transform: [scale, 0, 0, -scale, 0, height * scale] }
		};
	}

	it('reports a selection in page space, not window space', () => {
		// A rectangle 10 across and 20 down from the page's own corner, on a page
		// that is itself 100 across and 200 down the window.
		const rects = clientRectsToPdf([{ left: 110, top: 220, width: 200, height: 12 }], frameAt(1));

		expect(rects).toHaveLength(1);
		expect(rects[0].x).toBeCloseTo(10, 6);
		// PDF y grows upward from the foot of the page: 800 - 20 - 12.
		expect(rects[0].y).toBeCloseTo(768, 6);
		expect(rects[0].w).toBeCloseTo(200, 6);
	});

	it('gives the same answer whatever the zoom was at the time', () => {
		// This is the point of storing in user space. The same words selected at
		// 50% and at 200% have to come out as the same rectangle, or a highlight
		// is only correct at the zoom it was made at.
		const atHalf = clientRectsToPdf(
			[{ left: 100 + 10 * 0.5, top: 200 + 20 * 0.5, width: 200 * 0.5, height: 12 * 0.5 }],
			frameAt(0.5)
		);
		const atDouble = clientRectsToPdf(
			[{ left: 100 + 10 * 2, top: 200 + 20 * 2, width: 200 * 2, height: 12 * 2 }],
			frameAt(2)
		);

		expect(atHalf[0].x).toBeCloseTo(atDouble[0].x, 6);
		expect(atHalf[0].y).toBeCloseTo(atDouble[0].y, 6);
		expect(atHalf[0].w).toBeCloseTo(atDouble[0].w, 6);
	});

	it('round-trips back to where it was drawn', () => {
		const frame = frameAt(1.5);
		const original = { left: 100 + 30, top: 200 + 40, width: 250, height: 14 };

		const stored = clientRectsToPdf([original], frame);
		const [drawn] = pdfRectsToClient(stored, frame);

		// Page-relative on the way back, so the window offset is gone.
		expect(drawn.left).toBeCloseTo(original.left - frame.bounds.left, 4);
		expect(drawn.top).toBeCloseTo(original.top - frame.bounds.top, 4);
		expect(drawn.width).toBeCloseTo(original.width, 4);
		expect(drawn.height).toBeCloseTo(original.height, 4);
	});

	it('keeps only the part of a selection that is on this page', () => {
		// Dragging across a page break selects on both. Each page stores its own
		// half rather than one page claiming a rectangle floating past its edge.
		const frame = frameAt(1);
		const onThisPage = { left: 110, top: 220, width: 200, height: 12 };
		const onTheNextOne = { left: 110, top: 1400, width: 200, height: 12 };

		const rects = clientRectsToPdf([onThisPage, onTheNextOne], frame);

		expect(rects).toHaveLength(1);
		expect(rects[0].y).toBeCloseTo(768, 6);
	});

	it('joins the runs one line of text arrives in', () => {
		// getClientRects splits at every style change, so a sentence with an
		// italic word in it comes back in three pieces and should be drawn as one.
		const rects = clientRectsToPdf(
			[
				{ left: 110, top: 220, width: 80, height: 12 },
				{ left: 190, top: 220, width: 40, height: 12 },
				{ left: 230, top: 220, width: 60, height: 12 }
			],
			frameAt(1)
		);

		expect(rects).toHaveLength(1);
		expect(rects[0].w).toBeCloseTo(180, 6);
	});

	it('has nothing to store for a selection that missed the page entirely', () => {
		expect(
			clientRectsToPdf([{ left: 5000, top: 5000, width: 10, height: 10 }], frameAt(1))
		).toEqual([]);
	});
});

describe('crossing from the window into the page', () => {
	it('accounts for how far the reader has scrolled', () => {
		// getClientRects answers relative to the window, which stops being true the
		// moment anything scrolls. A highlight stored from a scrolled window would
		// land higher up the page by exactly the scroll distance.
		const container = { left: 40, top: 60, width: 800, height: 600 };

		const moved = toContentSpace({ left: 140, top: 160, width: 200, height: 12 }, container, {
			left: 0,
			top: 500
		});

		expect(moved).toEqual({ left: 100, top: 600, width: 200, height: 12 });
	});

	it('gives the same page position from two different scroll offsets', () => {
		// The same words, looked at after scrolling, must produce the same anchor.
		const container = { left: 0, top: 0, width: 800, height: 600 };

		const unscrolled = toContentSpace({ left: 100, top: 400, width: 200, height: 12 }, container, {
			left: 0,
			top: 0
		});
		const scrolled = toContentSpace({ left: 100, top: 100, width: 200, height: 12 }, container, {
			left: 0,
			top: 300
		});

		expect(scrolled).toEqual(unscrolled);
	});
});
