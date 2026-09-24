import type { Rect } from './location';

/**
 * The order marks are read in.
 *
 * Page order alone is not enough, and sorting within a page by when a mark was
 * made is worse than no sort at all: highlight the conclusion of page 3 and then
 * its opening line, and the list disagrees with the paper. A reader scanning the
 * panel beside the page is matching it against what they can see, so the two
 * have to agree.
 *
 * Zotero solves this with a `sortIndex` computed from page, vertical position
 * and horizontal position, and stores it on the annotation. Erti derives it
 * instead, from the rectangles already stored — the same answer without a column
 * that can fall out of step with the geometry it summarises.
 */
export interface Placed {
	page: number;
	/** JSON array of `{x, y, w, h}` in PDF user space, or null for a page note. */
	rects: string | null;
	created_at: string;
}

export interface Position {
	page: number;
	/** Distance down the page. PDF y grows upward, so this is its negation. */
	top: number;
	left: number;
}

function parse(json: string | null): Rect[] {
	if (!json) return [];
	try {
		const parsed = JSON.parse(json);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		// A malformed anchor costs that mark its place in the order, not the order.
		return [];
	}
}

/**
 * Where a mark sits, as two numbers that sort.
 *
 * A mark with no rectangles is a note about the page rather than about anything
 * on it, so it goes to the top of its page — which is where the eye starts, and
 * where a note that introduces the page belongs.
 */
export function positionOf(mark: Placed): Position {
	const rects = parse(mark.rects);
	if (rects.length === 0) return { page: mark.page, top: -Infinity, left: -Infinity };

	// The top edge of the highest rectangle, and the left edge of the leftmost.
	// Taking the extremes rather than the first rectangle keeps a passage that
	// wraps across a column break in the place it starts.
	const top = Math.max(...rects.map((rect) => rect.y + rect.h));
	const left = Math.min(...rects.map((rect) => rect.x));

	return { page: mark.page, top: -top, left };
}

/**
 * Front to back, top to bottom, left to right.
 *
 * Creation time is the last resort rather than the second: two marks at the same
 * point on the same page is a duplicate, and the only thing left that can tell
 * them apart is which came first.
 */
export function byReadingOrder(a: Placed, b: Placed): number {
	const first = positionOf(a);
	const second = positionOf(b);

	return (
		first.page - second.page ||
		first.top - second.top ||
		first.left - second.left ||
		a.created_at.localeCompare(b.created_at)
	);
}
