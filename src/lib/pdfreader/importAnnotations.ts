import type { Line } from '$lib/ingest/extract';

import { mergeRects, type Rect } from './location';

/**
 * Highlights people already made, in another tool.
 *
 * Most researchers arrive with a library that has been marked up for years, in
 * Zotero or Preview or Adobe. Erti showing none of it would make the reading
 * side look empty on the very corpus it is meant to be useful for — and would
 * quietly suggest that starting again is the price of using it.
 *
 * The mapping is deliberately conservative. Anything it cannot place, it leaves
 * out rather than guessing, and everything it does bring in is marked
 * `imported`, so a mark someone else made is never mistaken for one of yours
 * and the whole lot can be undone in one action.
 */

/** The pdf.js annotation fields this reads. */
export interface PdfAnnotationLike {
	subtype?: string;
	quadPoints?: number[] | Float32Array | null;
	rect?: number[] | null;
	contents?: string | null;
	color?: Uint8ClampedArray | number[] | null;
}

/** The kinds worth bringing across. */
const TEXT_MARKUP = new Set(['Highlight', 'Underline', 'Squiggly', 'StrikeOut']);
const NOTES = new Set(['Text', 'FreeText']);

export function isImportable(annotation: PdfAnnotationLike): boolean {
	const subtype = annotation.subtype ?? '';
	return TEXT_MARKUP.has(subtype) || NOTES.has(subtype);
}

/**
 * Quadrilaterals to rectangles.
 *
 * The PDF specification stores each marked quad as four corners, and disagrees
 * with several producers about which order they come in — Acrobat writes
 * upper-left first, others write lower-left. Taking the extremes of all four
 * points sidesteps the argument entirely, and marked text is axis-aligned in
 * practice anyway.
 */
export function quadPointsToRects(quadPoints: number[] | Float32Array | null | undefined): Rect[] {
	if (!quadPoints || quadPoints.length < 8) return [];

	const rects: Rect[] = [];

	for (let i = 0; i + 8 <= quadPoints.length; i += 8) {
		const xs = [quadPoints[i], quadPoints[i + 2], quadPoints[i + 4], quadPoints[i + 6]];
		const ys = [quadPoints[i + 1], quadPoints[i + 3], quadPoints[i + 5], quadPoints[i + 7]];

		const x = Math.min(...xs);
		const y = Math.min(...ys);

		rects.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
	}

	return mergeRects(rects);
}

/** A `[x1, y1, x2, y2]` rect, as pdf.js reports one for a note icon. */
export function rectToBox(rect: number[] | null | undefined): Rect[] {
	if (!rect || rect.length < 4) return [];

	const x = Math.min(rect[0], rect[2]);
	const y = Math.min(rect[1], rect[3]);

	return [{ x, y, w: Math.abs(rect[2] - rect[0]), h: Math.abs(rect[3] - rect[1]) }];
}

function hueOf(rgb: [number, number, number]): number {
	const [r, g, b] = rgb.map((c) => c / 255);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;

	if (d === 0) return -1;
	if (max === r) return (((g - b) / d + (g < b ? 6 : 0)) / 6) * 360;
	if (max === g) return (((b - r) / d + 2) / 6) * 360;
	return (((r - g) / d + 4) / 6) * 360;
}

/**
 * The label whose colour is closest to the one the other tool used.
 *
 * Matched on hue alone, because tools differ far more in how saturated and how
 * pale they draw a highlight than in which colour they meant — and hue is the
 * part a reader was choosing. A grey or colourless mark matches nothing and
 * comes in unlabelled, which is honest: there is no colour to read a meaning
 * from.
 */
export function nearestLabel(
	colour: Uint8ClampedArray | number[] | null | undefined,
	labels: Array<{ id: string; colour: string; enabled: boolean }>
): string | null {
	if (!colour || colour.length < 3) return null;

	const hue = hueOf([colour[0], colour[1], colour[2]]);
	if (hue < 0) return null;

	let best: string | null = null;
	let closest = Infinity;

	for (const label of labels) {
		if (!label.enabled) continue;

		const labelHue = parseFloat(label.colour.split(/\s+/)[0]);
		if (Number.isNaN(labelHue)) continue;

		// Around the circle, so red at 355 is near red at 5.
		const apart = Math.min(Math.abs(hue - labelHue), 360 - Math.abs(hue - labelHue));
		if (apart < closest) {
			closest = apart;
			best = label.id;
		}
	}

	// Beyond a quarter turn the two are not the same colour by any reading, and
	// a wrong label is worse than none.
	return closest <= 45 ? best : null;
}

/** Does a line of text fall inside a marked rectangle? */
function overlaps(line: Line, rect: Rect): boolean {
	const lineTop = line.y + line.fontSize;
	const verticallyInside = line.y < rect.y + rect.h && lineTop > rect.y;
	const horizontallyInside = line.x < rect.x + rect.w && line.right > rect.x;

	return verticallyInside && horizontallyInside;
}

/**
 * Recover the words a highlight was drawn over.
 *
 * The PDF stores where the mark is, not what it says — so without this an
 * imported highlight is a coloured rectangle with no text, invisible to search
 * and useless in the drafting panel. Matched at line granularity, which is
 * coarser than the mark but is what the extracted text has to offer.
 */
export function quoteFromLines(lines: Line[], rects: Rect[]): string {
	const touched = lines.filter((line) => rects.some((rect) => overlaps(line, rect)));

	return touched
		.map((line) => line.text)
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * A stable identity for an imported mark.
 *
 * Re-scanning a folder must not add the same highlight again, and the source
 * PDF carries no id for it — so one is derived from where it is. Rounded,
 * because producers write coordinates at different precisions and a mark that
 * differs in the fourth decimal is the same mark.
 */
export function importKey(sha256: string, page: number, rects: Rect[]): string {
	const shape = rects
		.map((r) => [r.x, r.y, r.w, r.h].map((n) => Math.round(n)).join(','))
		.join(';');

	return `${sha256}:${page}:${shape}`;
}

export interface ImportCandidate {
	key: string;
	page: number;
	rects: Rect[];
	quote: string;
	note: string | null;
	labelId: string | null;
}

/** Everything worth importing from one page. */
export function candidatesFromPage(
	sha256: string,
	page: number,
	annotations: PdfAnnotationLike[],
	lines: Line[],
	labels: Array<{ id: string; colour: string; enabled: boolean }>
): ImportCandidate[] {
	const out: ImportCandidate[] = [];

	for (const annotation of annotations) {
		if (!isImportable(annotation)) continue;

		const rects =
			quadPointsToRects(annotation.quadPoints).length > 0
				? quadPointsToRects(annotation.quadPoints)
				: rectToBox(annotation.rect);

		if (rects.length === 0) continue;

		const note = annotation.contents?.trim() || null;
		const quote = quoteFromLines(lines, rects);

		// Nothing to show and nothing to say: a stray mark on a blank part of the
		// page, which is noise rather than a note.
		if (!quote && !note) continue;

		out.push({
			key: importKey(sha256, page, rects),
			page,
			rects,
			quote,
			note,
			labelId: nearestLabel(annotation.color, labels)
		});
	}

	return out;
}

/**
 * Walk a document for marks worth offering.
 *
 * The page accessors are injected so this can be tested without pdf.js, and so
 * every pdf.js import in the reader stays inside `viewer.ts`.
 *
 * `already` holds the keys of marks imported before. Re-scanning a folder is
 * routine — it happens whenever a PDF is added — and without this every scan
 * would lay another copy of the same highlights over the last.
 */
export async function collectImportable(
	sha256: string,
	pageCount: number,
	getAnnotations: (page: number) => Promise<PdfAnnotationLike[]>,
	getLines: (page: number) => Promise<Line[]>,
	labels: Array<{ id: string; colour: string; enabled: boolean }>,
	already: ReadonlySet<string> = new Set()
): Promise<ImportCandidate[]> {
	const found: ImportCandidate[] = [];

	for (let page = 1; page <= pageCount; page++) {
		let annotations: PdfAnnotationLike[];
		try {
			annotations = await getAnnotations(page);
		} catch {
			// One unreadable page should not abandon the other three hundred.
			continue;
		}

		if (!annotations.some(isImportable)) continue;

		// The text is only read for pages that actually carry marks: extracting
		// every page of a thesis to find highlights on four of them is the
		// difference between an offer that appears and one that hangs.
		let lines: Line[] = [];
		try {
			lines = await getLines(page);
		} catch {
			lines = [];
		}

		for (const candidate of candidatesFromPage(sha256, page, annotations, lines, labels)) {
			if (already.has(candidate.key)) continue;
			found.push(candidate);
		}
	}

	return found;
}
