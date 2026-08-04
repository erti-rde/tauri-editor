/**
 * PDF text extraction from pdf.js item geometry.
 *
 * The previous implementation joined text items with the empty string, so real
 * output contained "theobserved effect": pdf.js emits positioned runs, not
 * words, and adjacent runs usually need a space between them. Embeddings were
 * therefore computed on corrupted text, which nothing downstream can compensate
 * for.
 *
 * This module is deliberately free of Tauri, Svelte and path aliases so the
 * retrieval benchmark can import the very same code the app runs. A copy would
 * drift and stop measuring what ships.
 */

/** The shape of a pdf.js text item, narrowed to what we use. */
export interface TextItemLike {
	str: string;
	/** [a, b, c, d, e, f] — e and f are the x and y origin. */
	transform: number[];
	width: number;
	height: number;
	hasEOL?: boolean;
	fontName?: string;
}

export interface Line {
	text: string;
	/** Left edge, in PDF user units. */
	x: number;
	/** Baseline y. PDF y grows upward, so larger is higher on the page. */
	y: number;
	/** Right edge. */
	right: number;
	/** Glyph height, used as a proxy for font size when classifying headings. */
	fontSize: number;
	fontName: string;
	page: number;
}

export interface ExtractedPage {
	page: number;
	lines: Line[];
	/** Number of columns detected, for diagnostics. */
	columns: number;
}

const isTextItem = (item: unknown): item is TextItemLike =>
	typeof item === 'object' && item !== null && 'str' in item;

/**
 * Group items into visual lines.
 *
 * Items on one line share a baseline, but not exactly — superscripts, inline
 * maths and font changes shift it slightly, so baselines are bucketed with a
 * tolerance derived from the text size rather than compared for equality.
 */
function groupIntoLines(items: TextItemLike[], page: number): Line[] {
	const usable = items.filter((i) => i.str.length > 0 && i.width > 0);
	if (usable.length === 0) return [];

	const medianHeight = median(usable.map((i) => i.height).filter((h) => h > 0)) || 10;
	const tolerance = medianHeight * 0.5;

	const rows: TextItemLike[][] = [];
	for (const item of [...usable].sort((a, b) => b.transform[5] - a.transform[5])) {
		const y = item.transform[5];
		const row = rows[rows.length - 1];
		const rowY = row?.[0]?.transform[5];

		if (row && rowY !== undefined && Math.abs(rowY - y) <= tolerance) {
			row.push(item);
		} else {
			rows.push([item]);
		}
	}

	return rows.map((row) => buildLine(row, page));
}

/**
 * Join one row of items into text, inserting spaces where the geometry shows a
 * gap.
 *
 * pdf.js splits a run wherever the font or spacing changes, so "the observed"
 * can arrive as two items with no space of its own. The gap between the previous
 * item's right edge and the next item's origin is what distinguishes a word
 * boundary from a mid-word split.
 */
function buildLine(row: TextItemLike[], page: number): Line {
	const sorted = [...row].sort((a, b) => a.transform[4] - b.transform[4]);
	const fontSize = median(sorted.map((i) => i.height).filter((h) => h > 0)) || 10;

	let text = '';
	let previousRight: number | null = null;

	for (const item of sorted) {
		const x = item.transform[4];

		if (previousRight !== null) {
			const gap = x - previousRight;
			// A quarter of the font size is comfortably below a real space and
			// safely above the sub-pixel overlap of a mid-word split.
			const endsWithSpace = /\s$/.test(text);
			const startsWithSpace = /^\s/.test(item.str);
			if (gap > fontSize * 0.25 && !endsWithSpace && !startsWithSpace) {
				text += ' ';
			}
		}

		text += item.str;
		previousRight = x + item.width;
	}

	const xs = sorted.map((i) => i.transform[4]);
	return {
		text: text.replace(/\s+/g, ' ').trim(),
		x: Math.min(...xs),
		y: sorted[0].transform[5],
		right: Math.max(...sorted.map((i) => i.transform[4] + i.width)),
		fontSize,
		fontName: sorted[0].fontName ?? '',
		page
	};
}

/**
 * Find the x of a column gutter, if the page has one.
 *
 * Detected from the items themselves rather than from assembled lines: lines
 * have to be built *within* a column, because two columns share vertical space
 * and grouping by baseline first merges the left column's text into the right's.
 *
 * Candidate splits are scored by how many items they would cut through, rather
 * than by looking for a completely empty band. An empty-band test is too
 * brittle — on a real two-column page a single equation number sitting in the
 * gutter was enough to hide it entirely.
 */
export function findColumnGutter(items: TextItemLike[]): number | null {
	if (items.length < 20) return null;

	const left = Math.min(...items.map((i) => i.transform[4]));
	const right = Math.max(...items.map((i) => i.transform[4] + i.width));
	const pageWidth = right - left;
	if (pageWidth <= 0) return null;

	// Score candidate splits by how many items they would cut through. Requiring a
	// completely empty band is too brittle: a single equation number or figure
	// label parked in the gutter is enough to hide it.
	const crossingsAt = (x: number) =>
		items.filter((i) => i.transform[4] < x && i.transform[4] + i.width > x).length;

	const from = left + pageWidth * 0.3;
	const to = left + pageWidth * 0.7;

	let fewest = Number.POSITIVE_INFINITY;
	for (let x = from; x <= to; x += 1) {
		fewest = Math.min(fewest, crossingsAt(x));
	}

	// A genuine gutter is crossed by almost nothing. Prose crossing the middle of
	// a single-column page is the normal case and scores far higher.
	if (fewest > Math.max(2, items.length * 0.02)) return null;

	// Take the centre of the widest run that achieves the minimum, rather than its
	// first x. The left edge of the gap sits flush against the left column, which
	// would push borderline items into the wrong one.
	let bestRun = { start: from, length: 0 };
	let runStart: number | null = null;
	for (let x = from; x <= to + 1; x += 1) {
		if (x <= to && crossingsAt(x) === fewest) {
			if (runStart === null) runStart = x;
		} else if (runStart !== null) {
			if (x - runStart > bestRun.length) bestRun = { start: runStart, length: x - runStart };
			runStart = null;
		}
	}

	const gutter = bestRun.start + bestRun.length / 2;

	// Both sides must actually carry text, or this is a wide indent or a figure.
	const leftItems = items.filter((i) => i.transform[4] + i.width <= gutter).length;
	const rightItems = items.filter((i) => i.transform[4] >= gutter).length;
	if (leftItems < items.length * 0.2 || rightItems < items.length * 0.2) return null;

	return gutter;
}

const sortTopDown = (lines: Line[]) => [...lines].sort((a, b) => b.y - a.y || a.x - b.x);

/**
 * Drop lines that repeat at the same position across many pages.
 *
 * Running heads, journal names and page numbers otherwise become chunks of their
 * own and match anything, and they interrupt sentences that span a page break.
 */
export function stripRunningHeadersAndFooters(pages: ExtractedPage[]): ExtractedPage[] {
	if (pages.length < 4) return pages;

	const EDGE = 2;

	/**
	 * Indices eligible to be furniture: the first and last couple of lines.
	 *
	 * The windows shrink on short pages so they can never meet. If they covered
	 * every line, any recurring line — including ordinary body text — would be
	 * deleted, which on a three-line page emptied the document entirely.
	 */
	const edgeIndices = (lineCount: number): Set<number> => {
		const edge = Math.min(EDGE, Math.floor((lineCount - 1) / 2));
		if (edge < 1) return new Set();
		return new Set([
			...Array.from({ length: edge }, (_, i) => i),
			...Array.from({ length: edge }, (_, i) => lineCount - 1 - i)
		]);
	};

	const counts = new Map<string, number>();
	for (const page of pages) {
		const edges = edgeIndices(page.lines.length);
		// Count a given text once per page, so a line appearing in both windows
		// cannot reach the threshold on its own.
		const seenOnThisPage = new Set<string>();
		for (const i of edges) {
			const key = normaliseForRepeatDetection(page.lines[i].text);
			if (key.length > 0 && !seenOnThisPage.has(key)) {
				seenOnThisPage.add(key);
				counts.set(key, (counts.get(key) ?? 0) + 1);
			}
		}
	}

	const threshold = Math.max(3, Math.floor(pages.length * 0.5));
	const repeated = new Set([...counts].filter(([, n]) => n >= threshold).map(([k]) => k));
	if (repeated.size === 0) return pages;

	return pages.map((page) => {
		const edges = edgeIndices(page.lines.length);
		return {
			...page,
			lines: page.lines.filter(
				(line, i) => !(edges.has(i) && repeated.has(normaliseForRepeatDetection(line.text)))
			)
		};
	});
}

/** Digits vary per page, so they are masked before comparing running heads. */
const normaliseForRepeatDetection = (text: string) =>
	text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

/**
 * Extract every page of a document, in reading order.
 *
 * `getPage`/`getTextContent` are supplied by the caller so this stays free of a
 * direct pdf.js dependency and can be tested with fixtures.
 */
export async function extractPages(doc: {
	numPages: number;
	getPage: (n: number) => Promise<{
		getTextContent: () => Promise<{ items: unknown[] }>;
		cleanup: () => void;
	}>;
}): Promise<ExtractedPage[]> {
	const pages: ExtractedPage[] = [];

	for (let n = 1; n <= doc.numPages; n++) {
		const page = await doc.getPage(n);
		try {
			const content = await page.getTextContent();
			const items = content.items.filter(isTextItem).filter((i) => i.str.length > 0 && i.width > 0);

			// Columns are resolved before lines are assembled. Two columns share
			// vertical space, so grouping by baseline first splices the left
			// column's text into the right column's lines.
			const gutter = findColumnGutter(items);

			if (gutter === null) {
				pages.push({ page: n, lines: sortTopDown(groupIntoLines(items, n)), columns: 1 });
			} else {
				const pageLeft = Math.min(...items.map((i) => i.transform[4]));
				const pageWidth = Math.max(...items.map((i) => i.transform[4] + i.width)) - pageLeft;

				// Only genuinely wide items span the page — a title, a full-width
				// figure or table — and those read before the columns beneath them.
				// A narrow item parked in the gutter (an equation number, a figure
				// label) is noise and belongs to whichever column its centre is in.
				const spanning = items.filter(
					(i) =>
						i.transform[4] < gutter &&
						i.transform[4] + i.width > gutter &&
						i.width > pageWidth * 0.3
				);
				const spanningSet = new Set(spanning);
				const inLeftColumn = (i: TextItemLike) => i.transform[4] + i.width / 2 < gutter;
				const leftItems = items.filter((i) => !spanningSet.has(i) && inLeftColumn(i));
				const rightItems = items.filter((i) => !spanningSet.has(i) && !inLeftColumn(i));

				pages.push({
					page: n,
					lines: [
						...sortTopDown(groupIntoLines(spanning, n)),
						...sortTopDown(groupIntoLines(leftItems, n)),
						...sortTopDown(groupIntoLines(rightItems, n))
					],
					columns: 2
				});
			}
		} finally {
			page.cleanup();
		}
	}

	return stripRunningHeadersAndFooters(pages);
}

/**
 * Flatten pages to plain text, rejoining words hyphenated across a line break.
 */
export function pagesToText(pages: ExtractedPage[]): string {
	const out: string[] = [];

	for (const page of pages) {
		for (const line of page.lines) {
			const previous = out[out.length - 1];
			// "distri-\nbution" is one word, and leaving the hyphen in produces a
			// token the model has never seen.
			if (previous && /[a-z]-$/.test(previous) && /^[a-z]/.test(line.text)) {
				out[out.length - 1] = previous.slice(0, -1) + line.text;
			} else {
				out.push(line.text);
			}
		}
	}

	return out.join(' ').replace(/\s+/g, ' ').trim();
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
