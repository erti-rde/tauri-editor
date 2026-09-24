import { describe, expect, it } from 'vitest';

import { anchorsFrom, readSelection } from './selection';
import type { PageFrame } from './location';

/**
 * The splitting is the part worth pinning down: a selection dragged over a page
 * break has to become two marks with the right halves, and a selection that is
 * really a stray click has to become nothing at all.
 */

const PAGE_HEIGHT = 800;

/** Two A4 pages stacked in the content, page 2 below page 1. */
function frames(scale = 1): PageFrame[] {
	return [1, 2].map((page) => ({
		page,
		bounds: {
			left: 0,
			top: (page - 1) * (PAGE_HEIGHT * scale + 10),
			width: 595 * scale,
			height: PAGE_HEIGHT * scale
		},
		viewport: { transform: [scale, 0, 0, -scale, 0, PAGE_HEIGHT * scale] }
	}));
}

/** The window sitting at the top of an unscrolled container. */
const container = {
	bounds: { left: 0, top: 0, width: 600, height: 700 },
	scroll: { left: 0, top: 0 }
};

describe('anchoring a selection', () => {
	it('makes one mark for a selection inside one page', () => {
		const anchors = anchorsFrom(
			[{ left: 72, top: 100, width: 400, height: 12 }],
			'the effect was strongest',
			frames(),
			container
		);

		expect(anchors).toHaveLength(1);
		expect(anchors[0].page).toBe(1);
		expect(anchors[0].quote).toBe('the effect was strongest');
	});

	it('splits a selection dragged over a page break', () => {
		// `annotations.page` holds one number, so this has to become two marks —
		// and each has to keep its own half rather than one page claiming both.
		const anchors = anchorsFrom(
			[
				{ left: 72, top: 700, width: 400, height: 12 },
				{ left: 72, top: 900, width: 400, height: 12 }
			],
			'a sentence that runs over the break',
			frames(),
			container
		);

		expect(anchors.map((a) => a.page)).toEqual([1, 2]);
		expect(anchors[0].rects).toHaveLength(1);
		expect(anchors[1].rects).toHaveLength(1);
	});

	it('accounts for the scroll, so a mark made further down lands where it was made', () => {
		const scrolled = { bounds: container.bounds, scroll: { left: 0, top: 810 } };

		const anchors = anchorsFrom(
			[{ left: 72, top: 100, width: 400, height: 12 }],
			'on the second page',
			frames(),
			scrolled
		);

		expect(anchors).toHaveLength(1);
		expect(anchors[0].page).toBe(2);
	});

	it('has nothing to say about an empty selection', () => {
		expect(anchorsFrom([], 'something', frames(), container)).toEqual([]);
	});

	it('ignores a selection of nothing but whitespace', () => {
		// Double-clicking in a margin selects a run of spaces. That is not a mark.
		expect(
			anchorsFrom([{ left: 72, top: 100, width: 40, height: 12 }], '   \n ', frames(), container)
		).toEqual([]);
	});

	it('ignores rectangles that land on no page at all', () => {
		expect(
			anchorsFrom(
				[{ left: 72, top: 5000, width: 400, height: 12 }],
				'off the end',
				frames(),
				container
			)
		).toEqual([]);
	});
});

describe('reading what is selected', () => {
	function element(): HTMLElement {
		const div = document.createElement('div');
		div.getBoundingClientRect = () => ({
			...container.bounds,
			right: 600,
			bottom: 700,
			x: 0,
			y: 0,
			toJSON: () => ({})
		});
		return div;
	}

	function fakeSelection(overrides: Partial<Selection> & { text?: string } = {}): Selection {
		return {
			isCollapsed: false,
			rangeCount: 1,
			toString: () => overrides.text ?? 'some words',
			getRangeAt: () => ({}) as Range,
			...overrides
		} as unknown as Selection;
	}

	it('says nothing for a plain click', () => {
		expect(readSelection(element(), frames(), fakeSelection({ isCollapsed: true }))).toBeNull();
	});

	it('says nothing when there is no selection at all', () => {
		expect(readSelection(element(), frames(), null)).toBeNull();
	});

	it('says nothing for a selection of whitespace', () => {
		expect(readSelection(element(), frames(), fakeSelection({ text: '  ' }))).toBeNull();
	});

	it('says nothing for a selection outside the pages', () => {
		// Selecting the toolbar, or a label in the sidebar, must not offer to
		// highlight a paper.
		const outside = element();
		outside.contains = () => false;

		expect(readSelection(outside, frames(), fakeSelection())).toBeNull();
	});
});
