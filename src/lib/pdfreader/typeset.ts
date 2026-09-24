import type { Rect } from './location';

/**
 * Put a mark on the words rather than around them.
 *
 * A selection's rectangles come from the browser, and a browser measures a
 * *line box*: the full em of the font plus whatever leading the layer carries.
 * That box is taller than the letters and sits higher than them, so a highlight
 * drawn on it rides above the text with a gap underneath, and an underline drawn
 * at its foot can land on the baseline — through the middle of the descenders,
 * which is why it reads as a strikethrough rather than a rule.
 *
 * The paper itself knows better. `extract.ts` already recovers, for every line,
 * where its baseline is and how tall its glyphs are, because it needs both to
 * tell a heading from a paragraph. Those two numbers are the whole answer: a
 * mark belongs to a band around a baseline, not to a rectangle a layout engine
 * happened to produce.
 *
 * Zotero solves this the same way, from the PDF's own character boxes.
 */

/** What a line of a page is, for this purpose. */
export interface TypeLine {
	/** Baseline, in PDF user units. PDF y grows upward. */
	y: number;
	/** Glyph height, standing in for the font size. */
	fontSize: number;
	x: number;
	right: number;
}

/**
 * How far a band reaches from the baseline, when nothing better is known.
 *
 * Measured rather than guessed. Asking a canvas for the ink extents of real
 * text — `actualBoundingBoxAscent` and `actualBoundingBoxDescent`, the true
 * edges of the drawn glyphs — gives, per em:
 *
 * | face            | ink above baseline | ink below |
 * | --------------- | ------------------ | --------- |
 * | Times New Roman | 0.695              | 0.216     |
 * | Helvetica       | 0.728              | 0.221     |
 * | Georgia         | 0.756              | 0.217     |
 *
 * The descent barely moves; the ascent spans 0.06em. These are the fallback for
 * when the rectangle itself cannot be consulted — `bandFor` below does better.
 */
export const ASCENT = 0.74;
export const DESCENT = 0.26;

/**
 * What share of the ascent a font reserves is actually inked.
 *
 * A font's ascent has to clear accented capitals — Å, Ő — which a paper's body
 * text almost never contains, so the reserved ascent overshoots the ink that
 * appears. Measured as ink ÷ reserved: Times 0.695/0.891 = 0.78, Helvetica
 * 0.728/0.920 = 0.79, Georgia 0.756/0.920 = 0.82.
 *
 * Taking the middle of that range means the band follows whatever the document
 * is actually set in rather than assuming Latin book faces — which is the point
 * of reading it off the rectangle instead of hardcoding it.
 */
const INKED_SHARE_OF_ASCENT = 0.8;

/**
 * Bounds, so no rectangle can produce an absurd band.
 *
 * A selection rectangle is usually one line's span box, and then the arithmetic
 * below is sound. It is not always: a rectangle spanning a paragraph, or one a
 * pixel tall from a degenerate range, would otherwise give a band that swallows
 * the page or vanishes.
 */
const MIN_ASCENT = 0.6;
const MAX_ASCENT = 0.95;
const MIN_DESCENT = 0.18;
const MAX_DESCENT = 0.34;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The band a line's letters occupy, assuming an ordinary Latin text face. */
export function bandOf(line: TypeLine): { bottom: number; height: number } {
	const bottom = line.y - DESCENT * line.fontSize;
	return { bottom, height: (ASCENT + DESCENT) * line.fontSize };
}

/**
 * The band a line's letters occupy, according to the document's own font.
 *
 * The general form, and the reason it is general: pdf.js sizes every text-layer
 * span from the real font, so the rectangle a browser hands back around a
 * selection *is* that font's ascent and descent about the baseline. The
 * baseline itself comes from the PDF. Between them there is nothing left to
 * assume about the typeface — a paper set in Computer Modern, in a Chinese
 * gothic, or in something a foundry invented last year describes its own
 * metrics, and the band follows them.
 *
 * The one thing still taken on faith is `INKED_SHARE_OF_ASCENT`, because a font
 * declares what it reserves and not what it draws, and no part of pdf.js exposes
 * per-glyph ink extents. That share is stable across the faces measured. Where
 * it will be wrong is a script whose ink genuinely fills the em — CJK, which has
 * no descenders and reaches the full ascent — and there the top of the band will
 * sit a little inside the glyphs.
 */
export function bandFor(rect: Rect, line: TypeLine): { bottom: number; height: number } {
	const size = line.fontSize;
	if (size <= 0) return bandOf(line);

	// What the font reserves, read off the rectangle rather than assumed.
	const reservedAscent = (rect.y + rect.h - line.y) / size;
	const reservedDescent = (line.y - rect.y) / size;

	// A rectangle that does not contain its own baseline is not a span box — a
	// merged multi-line rectangle, or one from a range that collapsed. The
	// measured constants are the better answer there.
	if (!(reservedAscent > 0) || !(reservedDescent > 0)) return bandOf(line);

	const ascent = clamp(INKED_SHARE_OF_ASCENT * reservedAscent, MIN_ASCENT, MAX_ASCENT);
	// The descent is inked to its full reserved depth — that is what a descender
	// is — so it is taken as it comes, bounded only against nonsense.
	const descent = clamp(reservedDescent, MIN_DESCENT, MAX_DESCENT);

	return { bottom: line.y - descent * size, height: (ascent + descent) * size };
}

/**
 * The line a rectangle belongs to.
 *
 * Chosen by where the baseline falls rather than by overlap area: a line box is
 * taller than its letters and often overlaps its neighbour, so the largest
 * overlap can name the wrong line. A baseline is unambiguous — it is inside the
 * rectangle or it is not — and among those that are, the nearest to the
 * rectangle's own centre wins.
 */
export function lineFor(rect: Rect, lines: TypeLine[]): TypeLine | null {
	const top = rect.y + rect.h;
	const centre = rect.y + rect.h / 2;

	let best: TypeLine | null = null;
	let closest = Infinity;

	for (const line of lines) {
		// Horizontally disjoint means a different column, whatever the y says.
		if (line.right < rect.x || line.x > rect.x + rect.w) continue;
		if (line.y < rect.y || line.y > top) continue;

		const distance = Math.abs(line.y - centre);
		if (distance < closest) {
			closest = distance;
			best = line;
		}
	}

	return best;
}

/**
 * Snap rectangles onto the lines they cover.
 *
 * Horizontal extent is left alone: the browser knows exactly which characters
 * were selected and where they start and stop, and that is the half of the
 * measurement it is good at. Only the vertical is replaced.
 *
 * A rectangle whose line cannot be identified is kept as it is. A page with no
 * text layer at all — a scan — has no lines to snap to, and a mark drawn a
 * little loosely is better than no mark.
 */
export function snapToLines(rects: Rect[], lines: TypeLine[]): Rect[] {
	if (lines.length === 0) return rects;

	return rects.map((rect) => {
		const line = lineFor(rect, lines);
		if (!line) return rect;

		const band = bandFor(rect, line);
		return { x: rect.x, w: rect.w, y: band.bottom, h: band.height };
	});
}

/**
 * Remember a page's lines, so marking the same page twice costs one fetch.
 *
 * A closure rather than a `Map` held in the component. Nothing here is
 * reactive — it is a memo, read imperatively while a drag is in flight — and a
 * bare `Map` in a component reads to the linter as reactive state that forgot
 * to be, which is a warning worth keeping rather than silencing.
 */
export function createLineCache() {
	const pages = new Map<number, TypeLine[]>();

	return {
		/** What is known already, or null to go and ask. */
		peek: (page: number) => pages.get(page) ?? null,
		remember: (page: number, lines: TypeLine[]) => void pages.set(page, lines),
		/** A different paper has different lines. */
		clear: () => pages.clear()
	};
}
