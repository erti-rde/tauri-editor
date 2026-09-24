import {
	clientRectsToPdf,
	toContentSpace,
	type ClientRectLike,
	type PageFrame,
	type Rect
} from './location';

/**
 * What the reader has selected, ready to become a mark.
 *
 * One of these per page. A selection dragged over a page break belongs to both
 * pages, and `annotations.page` holds one number — so it becomes two marks, the
 * way Zotero's reader also splits them. Storing only the first page's part would
 * quietly drop half of what was selected, and inventing a group column to hold
 * them together buys little: on screen they are already two bands of colour on
 * two separate pages, and treating them as two things is what the reader sees.
 */
export interface SelectionAnchor {
	page: number;
	rects: Rect[];
	/** The text on this page. Whole selections rarely span pages; this is its share. */
	quote: string;
}

export interface ContainerFrame {
	bounds: ClientRectLike;
	scroll: { left: number; top: number };
}

/**
 * Group a selection's rectangles onto the pages they fall on.
 *
 * The rectangles arrive in window coordinates and each page is measured in the
 * scrolling container's content coordinates, so they are moved across first.
 * `clientRectsToPdf` then keeps only the ones that land on the page it is given,
 * which is what does the splitting.
 */
export function anchorsFrom(
	rects: ClientRectLike[],
	quote: string,
	frames: PageFrame[],
	container: ContainerFrame
): SelectionAnchor[] {
	if (!quote.trim() || rects.length === 0) return [];

	const inContent = rects.map((rect) => toContentSpace(rect, container.bounds, container.scroll));

	const anchors: SelectionAnchor[] = [];

	for (const frame of frames) {
		const onThisPage = clientRectsToPdf(inContent, frame);
		if (onThisPage.length === 0) continue;

		anchors.push({ page: frame.page, rects: onThisPage, quote });
	}

	return anchors;
}

/** Which pages a set of rectangles touches, so only those need measuring. */
export function pagesTouched(
	rects: ClientRectLike[],
	frames: PageFrame[],
	container: ContainerFrame
): number[] {
	return anchorsFrom(rects, 'x', frames, container).map((anchor) => anchor.page);
}

/**
 * Read the current selection, if it is inside the pages.
 *
 * Returns null for a click, a collapsed caret, or a selection in the chrome
 * around the viewer — all of which happen constantly and none of which should
 * raise a menu.
 */
export function readSelection(
	container: HTMLElement,
	frames: PageFrame[],
	selection: Selection | null = window.getSelection()
): { anchors: SelectionAnchor[]; quote: string; focus: ClientRectLike } | null {
	if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

	const quote = selection.toString();
	if (!quote.trim()) return null;

	const range = selection.getRangeAt(0);
	if (!container.contains(range.commonAncestorContainer)) return null;

	const rects = [...range.getClientRects()].map((rect) => ({
		left: rect.left,
		top: rect.top,
		width: rect.width,
		height: rect.height
	}));
	if (rects.length === 0) return null;

	const frame: ContainerFrame = {
		bounds: container.getBoundingClientRect(),
		scroll: { left: container.scrollLeft, top: container.scrollTop }
	};

	const anchors = anchorsFrom(rects, quote, frames, frame);
	if (anchors.length === 0) return null;

	// The last rectangle, so a menu opens at the end of the drag — where the
	// pointer already is — rather than jumping back to where it started. In
	// content coordinates like everything else, so the menu stays attached to the
	// words if the reader scrolls while deciding.
	const last = rects[rects.length - 1];

	return { anchors, quote, focus: toContentSpace(last, frame.bounds, frame.scroll) };
}

/**
 * A range spanning two carets, whichever order they arrive in.
 *
 * What makes dragging the end of a mark work: the browser can say which
 * character sits under a pixel, so a pixel and a held position describe a
 * passage between them. The two are sorted, because dragging the start past the
 * end is an ordinary thing to do and should shrink the mark rather than produce
 * nothing.
 *
 * Only the end that moved is hit-tested. The other was resolved when the drag
 * began and is held as a position in the document, which survives the page
 * scrolling under it in a way a pixel does not.
 */
export function rangeFrom(from: Range, to: Range, doc: Document = document): Range | null {
	const range = doc.createRange();
	const backwards = from.compareBoundaryPoints(Range.START_TO_START, to) > 0;

	const first = backwards ? to : from;
	const last = backwards ? from : to;

	range.setStart(first.startContainer, first.startOffset);
	range.setEnd(last.startContainer, last.startOffset);

	return range.collapsed ? null : range;
}

/**
 * The caret position under a point.
 *
 * Two spellings of the same thing: WebKit and Blink have
 * `caretRangeFromPoint`, Firefox has `caretPositionFromPoint`. Tauri uses the
 * system webview, so which one exists depends on the platform.
 *
 * Both hit-test, which is the thing to know about them: they answer for the
 * topmost element at that point, so anything drawn over the words — a highlight
 * that takes clicks, a drag handle — answers instead of the text. Whatever asks
 * has to get out of its own way first.
 */
export function caretAtPoint(
	point: { x: number; y: number },
	doc: Document = document
): Range | null {
	const withRange = doc as Document & {
		caretRangeFromPoint?: (x: number, y: number) => Range | null;
	};
	if (typeof withRange.caretRangeFromPoint === 'function') {
		return withRange.caretRangeFromPoint(point.x, point.y);
	}

	const withPosition = doc as Document & {
		caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
	};
	if (typeof withPosition.caretPositionFromPoint === 'function') {
		const position = withPosition.caretPositionFromPoint(point.x, point.y);
		if (!position) return null;

		const range = doc.createRange();
		range.setStart(position.offsetNode, position.offset);
		range.collapse(true);
		return range;
	}

	return null;
}
