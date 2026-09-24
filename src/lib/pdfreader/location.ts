/**
 * Where something is in a PDF, and how to find it again.
 *
 * A highlight has to survive zoom, a re-render, a restart, and the file moving
 * on disk. It does not have to survive the PDF's bytes changing: that produces
 * a different sha256, which is a different source by design.
 *
 * So a location carries two anchors that fail in different ways. The rectangles
 * are exact and cost nothing to draw, but they are geometry and say nothing
 * about what was under them. The quote says exactly what was selected but has to
 * be searched for. Keeping both means a highlight can be drawn immediately and
 * still be repairable, and — the part that matters downstream — it makes the
 * passage itself searchable rather than only positioned.
 *
 * This module is deliberately free of Tauri, Svelte, pdf.js and path aliases,
 * for the same reason `extract.ts` is: the geometry and the matching are where
 * the bugs live, and they should be testable without mounting anything.
 */

/** A rectangle in PDF user space: origin bottom-left, y growing upward. */
export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** A rectangle in viewport space: origin top-left, y growing downward, CSS pixels. */
export interface ViewRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * The text around a passage, which is what finds it again when the geometry no
 * longer agrees. The shape is the W3C Web Annotation `TextQuoteSelector`, so
 * exported annotations mean the same thing to anything else that reads them.
 */
export interface QuoteSelector {
	quote: string;
	prefix?: string;
	suffix?: string;
}

/** A place in a PDF. Rects and selector are both optional: a page note has neither. */
export interface PdfLocation {
	/** 1-based, matching a page navigator and `chunks.page_start`. */
	page: number;
	rects?: Rect[];
	selector?: QuoteSelector;
}

/**
 * How much text either side of a quote is kept.
 *
 * Long enough to separate repeated boilerplate — "the effect was significant"
 * appears more than once in plenty of papers — and short enough that the stored
 * context is not itself most of the page.
 */
export const CONTEXT_LENGTH = 32;

/* ------------------------------------------------------------------ geometry */

/**
 * pdf.js's viewport, narrowed to the one field the transforms need.
 *
 * Taking the matrix rather than the whole viewport keeps this module free of
 * pdf.js while still consuming exactly what pdf.js produces.
 */
export interface ViewportLike {
	/** [a, b, c, d, e, f], mapping PDF user space onto viewport pixels. */
	transform: number[];
}

/** Apply a 2D affine matrix to a point. */
export function applyTransform(x: number, y: number, m: number[]): [number, number] {
	return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Invert an affine matrix.
 *
 * Needed because a browser selection arrives in viewport pixels and has to be
 * stored in user space — otherwise every stored rectangle would be valid at
 * exactly one zoom level.
 */
export function invertTransform(m: number[]): number[] {
	const det = m[0] * m[3] - m[1] * m[2];
	if (det === 0) throw new Error('viewport transform is not invertible');

	return [
		m[3] / det,
		-m[1] / det,
		-m[2] / det,
		m[0] / det,
		(m[2] * m[5] - m[3] * m[4]) / det,
		(m[1] * m[4] - m[0] * m[5]) / det
	];
}

/**
 * PDF user space to viewport pixels.
 *
 * Both corners go through the matrix rather than the origin plus a scaled size,
 * because rotation and the y-flip mean the transformed corners are not
 * necessarily still top-left and bottom-right.
 */
export function rectToView(rect: Rect, viewport: ViewportLike): ViewRect {
	const [x1, y1] = applyTransform(rect.x, rect.y, viewport.transform);
	const [x2, y2] = applyTransform(rect.x + rect.w, rect.y + rect.h, viewport.transform);

	return {
		left: Math.min(x1, x2),
		top: Math.min(y1, y2),
		width: Math.abs(x2 - x1),
		height: Math.abs(y2 - y1)
	};
}

/** Viewport pixels back to PDF user space. */
export function viewRectToPdf(view: ViewRect, viewport: ViewportLike): Rect {
	const inverse = invertTransform(viewport.transform);

	const [x1, y1] = applyTransform(view.left, view.top, inverse);
	const [x2, y2] = applyTransform(view.left + view.width, view.top + view.height, inverse);

	return {
		x: Math.min(x1, x2),
		y: Math.min(y1, y2),
		w: Math.abs(x2 - x1),
		h: Math.abs(y2 - y1)
	};
}

/** Do two rectangles sit on the same line of text? */
function sameLine(a: Rect, b: Rect): boolean {
	const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
	return overlap > Math.min(a.h, b.h) / 2;
}

/** Merge rectangles that overlap or touch horizontally, assuming one line. */
function mergeAlong(line: Rect[], tolerance: number): Rect[] {
	const sorted = [...line].sort((a, b) => a.x - b.x);
	const merged: Rect[] = [];

	for (const rect of sorted) {
		const last = merged[merged.length - 1];

		if (last && rect.x <= last.x + last.w + tolerance) {
			const right = Math.max(last.x + last.w, rect.x + rect.w);
			const top = Math.max(last.y + last.h, rect.y + rect.h);
			last.y = Math.min(last.y, rect.y);
			last.w = right - last.x;
			last.h = top - last.y;
			continue;
		}

		merged.push({ ...rect });
	}

	return merged;
}

/**
 * Tidy the rectangles a browser selection produces.
 *
 * `getClientRects` emits one rectangle per text run, not per line, so a single
 * sentence can arrive as a dozen slivers with duplicates and zero-width
 * fragments among them. Drawn raw they show as visible seams, and stored raw
 * they are several times larger than they need to be.
 *
 * The result is in reading order — top of the page first, then left to right —
 * so a highlight's own rectangles are ordered the way it was read.
 */
export function mergeRects(rects: Rect[], tolerance = 1): Rect[] {
	const usable = rects.filter((r) => r.w > tolerance && r.h > tolerance);
	if (usable.length === 0) return [];

	// PDF y grows upward, so the highest top edge is the first line.
	const sorted = [...usable].sort((a, b) => b.y + b.h - (a.y + a.h) || a.x - b.x);

	const lines: Rect[][] = [];
	for (const rect of sorted) {
		const line = lines.find((candidate) => sameLine(candidate[0], rect));
		if (line) line.push(rect);
		else lines.push([rect]);
	}

	return lines.flatMap((line) => mergeAlong(line, tolerance));
}

/** The smallest rectangle containing all of them, for scrolling and hit-testing. */
export function boundingRect(rects: Rect[]): Rect | null {
	if (rects.length === 0) return null;

	const left = Math.min(...rects.map((r) => r.x));
	const bottom = Math.min(...rects.map((r) => r.y));
	const right = Math.max(...rects.map((r) => r.x + r.w));
	const top = Math.max(...rects.map((r) => r.y + r.h));

	return { x: left, y: bottom, w: right - left, h: top - bottom };
}

/* ---------------------------------------------------------------- text match */

/**
 * Collapse runs of whitespace to one space, keeping a way back to the
 * original offsets.
 *
 * Matching has to ignore whitespace because the two sides disagree about it by
 * construction: a selection in the viewer's text layer carries pdf.js's own run
 * boundaries, while `extract.ts` re-derives spacing from glyph geometry. The
 * same sentence is genuinely spelled differently in the two, and only in the
 * whitespace.
 *
 * `map[i]` is the index in the original string of collapsed character `i`, so a
 * match found in collapsed space can be reported in original offsets — which is
 * what `char_start`/`char_end` have to be to line up with `chunks`.
 */
export function collapseWhitespace(text: string): { text: string; map: number[] } {
	let out = '';
	const map: number[] = [];
	let inSpace = false;

	for (let i = 0; i < text.length; i++) {
		const char = text[i];

		if (/\s/.test(char)) {
			if (!inSpace) {
				out += ' ';
				map.push(i);
				inSpace = true;
			}
			continue;
		}

		out += char;
		map.push(i);
		inSpace = false;
	}

	return { text: out, map };
}

/**
 * Collapse whitespace and drop it from the ends.
 *
 * The trimming is what a quote wants and what context emphatically does not:
 * a stored prefix ends with the space before the passage, and trimming it
 * misaligns the comparison by exactly one character, which scores zero and
 * looks indistinguishable from context that genuinely disagrees. Hence the
 * split — `collapseWhitespace` for context, this for quotes and pages.
 */
export function normaliseWhitespace(text: string): { text: string; map: number[] } {
	const collapsed = collapseWhitespace(text);

	let start = 0;
	let end = collapsed.text.length;
	if (collapsed.text.startsWith(' ')) start = 1;
	if (end > start && collapsed.text.endsWith(' ')) end -= 1;

	return { text: collapsed.text.slice(start, end), map: collapsed.map.slice(start, end) };
}

function commonPrefixLength(a: string, b: string): number {
	let n = 0;
	while (n < a.length && n < b.length && a[n] === b[n]) n++;
	return n;
}

function commonSuffixLength(a: string, b: string): number {
	let n = 0;
	while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
	return n;
}

/**
 * How well a candidate match agrees with the context recorded around it.
 *
 * Characters are counted outward from the boundary, so a prefix that agrees for
 * ten characters and then diverges still scores ten. Partial credit matters:
 * the text before a passage is exactly what changes when a paper is
 * reformatted, and demanding an exact context match would reject the correct
 * hit as readily as a wrong one.
 */
function scoreHit(hay: string, at: number, length: number, selector: QuoteSelector): number {
	let score = 0;

	// Collapsed, not normalised: the boundary space belongs to the context and
	// is what makes it line up with the page either side of the candidate.
	if (selector.prefix) {
		const wanted = collapseWhitespace(selector.prefix).text;
		score += commonSuffixLength(hay.slice(0, at), wanted);
	}

	if (selector.suffix) {
		const wanted = collapseWhitespace(selector.suffix).text;
		score += commonPrefixLength(hay.slice(at + length), wanted);
	}

	return score;
}

/**
 * Find a recorded quote in a page's text.
 *
 * Returns offsets into `haystack` as given, not into its normalised form.
 * `hint` is a previously known offset, used only to break ties between
 * candidates the context cannot separate — a page that repeats a phrase in two
 * places with identical surroundings is rare, but "Table 1" is not.
 *
 * Null means the quote is not on this page at all, which is a real answer: the
 * caller falls back to the stored rectangles and marks the anchor as needing
 * repair rather than silently highlighting the wrong sentence.
 */
export function locateQuote(
	haystack: string,
	selector: QuoteSelector,
	hint?: number
): { start: number; end: number } | null {
	const needle = normaliseWhitespace(selector.quote).text;
	if (needle.length === 0) return null;

	const hay = normaliseWhitespace(haystack);

	const hits: number[] = [];
	for (let at = hay.text.indexOf(needle); at !== -1; at = hay.text.indexOf(needle, at + 1)) {
		hits.push(at);
	}

	if (hits.length === 0) return null;

	let best = hits[0];
	if (hits.length > 1) {
		let bestScore = -1;
		let bestDistance = Infinity;

		for (const at of hits) {
			const score = scoreHit(hay.text, at, needle.length, selector);
			const distance = hint === undefined ? 0 : Math.abs(hay.map[at] - hint);

			if (score > bestScore || (score === bestScore && distance < bestDistance)) {
				best = at;
				bestScore = score;
				bestDistance = distance;
			}
		}
	}

	return { start: hay.map[best], end: hay.map[best + needle.length - 1] + 1 };
}

/**
 * Capture a quote and the text around it, ready to store.
 *
 * Taken at the moment of selection, when the page's text is already in hand and
 * unambiguously correct.
 */
export function contextAround(text: string, start: number, end: number): QuoteSelector {
	return {
		quote: text.slice(start, end),
		prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
		suffix: text.slice(end, Math.min(text.length, end + CONTEXT_LENGTH))
	};
}

/* --------------------------------------------------------------- selection */

/** A rectangle as the DOM reports it, in client coordinates. */
export interface ClientRectLike {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * One rendered page, and what is needed to translate against it.
 *
 * Taken as plain numbers rather than elements so the arithmetic below can be
 * tested without a laid-out document — which is the whole reason it lives here
 * and not in the component.
 */
export interface PageFrame {
	page: number;
	/**
	 * The page's own rectangle.
	 *
	 * In whatever space the rectangles being converted are in — the two are
	 * subtracted, so they have to agree. The reader uses the scrolling
	 * container's content coordinates for both, because that is the space a
	 * highlight has to be drawn in to scroll with its page, and it means a
	 * selection has to be converted out of client coordinates before it gets
	 * here rather than each caller picking a space.
	 */
	bounds: ClientRectLike;
	viewport: ViewportLike;
}

/**
 * Move a rectangle out of the window's coordinates into a scrolling element's
 * content coordinates.
 *
 * `getClientRects` answers relative to the window, which stops being true the
 * moment anything scrolls. Everything downstream works in content coordinates,
 * so this is where selections cross over.
 */
export function toContentSpace(
	rect: ClientRectLike,
	containerBounds: ClientRectLike,
	scroll: { left: number; top: number }
): ClientRectLike {
	return {
		left: rect.left - containerBounds.left + scroll.left,
		top: rect.top - containerBounds.top + scroll.top,
		width: rect.width,
		height: rect.height
	};
}

/** Does a rectangle overlap a page at all? */
function intersects(rect: ClientRectLike, bounds: ClientRectLike): boolean {
	return (
		rect.left < bounds.left + bounds.width &&
		rect.left + rect.width > bounds.left &&
		rect.top < bounds.top + bounds.height &&
		rect.top + rect.height > bounds.top
	);
}

/**
 * Turn what the browser says was selected into something worth storing.
 *
 * `Range.getClientRects` reports in client coordinates, at the zoom in force at
 * that moment, relative to the window. Stored as-is a highlight would be correct
 * at exactly one zoom, on one window size, until the first scroll — so the
 * rectangles are made relative to the page and then put back into PDF user
 * space, which is the one frame of reference that does not move.
 *
 * Rectangles that miss this page are dropped rather than clamped: a selection
 * dragged across a page break belongs to both pages, and each page keeps only
 * its own part.
 */
export function clientRectsToPdf(rects: ClientRectLike[], frame: PageFrame): Rect[] {
	const mine = rects.filter((rect) => intersects(rect, frame.bounds));

	const inPdfSpace = mine.map((rect) =>
		viewRectToPdf(
			{
				left: rect.left - frame.bounds.left,
				top: rect.top - frame.bounds.top,
				width: rect.width,
				height: rect.height
			},
			frame.viewport
		)
	);

	return mergeRects(inPdfSpace);
}

/**
 * And back again, to draw a stored highlight over the page as it is now.
 *
 * Page-relative rather than client coordinates, because the layer this feeds is
 * positioned inside the page element and scrolls with it.
 */
export function pdfRectsToClient(rects: Rect[], frame: PageFrame): ViewRect[] {
	return rects.map((rect) => rectToView(rect, frame.viewport));
}
