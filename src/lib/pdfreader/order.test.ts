import { describe, expect, it } from 'vitest';

import { byReadingOrder, positionOf } from './order';

const at = (page: number, y: number, x = 10, created = '2026-01-01') => ({
	page,
	rects: JSON.stringify([{ x, y, w: 100, h: 12 }]),
	created_at: created
});

describe('where a mark sits', () => {
	it('turns PDF space the right way up, so higher on the page sorts first', () => {
		// PDF y grows upward: y=700 is nearer the top of the sheet than y=100.
		expect(positionOf(at(1, 700)).top).toBeLessThan(positionOf(at(1, 100)).top);
	});

	it('takes the start of a passage that wraps, not its first rectangle', () => {
		const wrapped = {
			page: 1,
			rects: JSON.stringify([
				{ x: 300, y: 200, w: 100, h: 12 },
				{ x: 40, y: 700, w: 100, h: 12 }
			]),
			created_at: '2026-01-01'
		};

		expect(positionOf(wrapped)).toEqual({ page: 1, top: -712, left: 40 });
	});

	it('puts a note about the page above everything on it', () => {
		const note = { page: 3, rects: null, created_at: '2026-01-01' };

		expect([at(3, 700), note].sort(byReadingOrder)[0]).toBe(note);
	});

	it('survives an anchor that will not parse', () => {
		expect(positionOf({ page: 2, rects: '{oops', created_at: '' })).toEqual({
			page: 2,
			top: -Infinity,
			left: -Infinity
		});
	});
});

describe('reading order', () => {
	it('is front to back before anything else', () => {
		expect([at(4, 700), at(1, 100)].sort(byReadingOrder).map((m) => m.page)).toEqual([1, 4]);
	});

	it('is top to bottom within a page, not oldest first', () => {
		// The complaint this answers: marking the conclusion of a page and then
		// its opening line listed them in that order, and the panel disagreed with
		// the paper it sits beside.
		const conclusion = at(3, 120, 10, '2026-01-01T09:00:00Z');
		const opening = at(3, 740, 10, '2026-01-01T09:05:00Z');

		expect([conclusion, opening].sort(byReadingOrder)).toEqual([opening, conclusion]);
	});

	it('is left to right for two marks on one line, as columns are read', () => {
		const right = at(2, 400, 320);
		const left = at(2, 400, 40);

		expect([right, left].sort(byReadingOrder)).toEqual([left, right]);
	});

	it('falls back to when it was made only when two marks sit in one place', () => {
		const later = at(1, 400, 10, '2026-02-01');
		const earlier = at(1, 400, 10, '2026-01-01');

		expect([later, earlier].sort(byReadingOrder)).toEqual([earlier, later]);
	});
});
