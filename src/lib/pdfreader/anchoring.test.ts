// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { clientRectsToPdf, rectToView, viewRectToPdf, type Rect } from './location';

/**
 * The transforms, checked against pdf.js itself on a real paper.
 *
 * The unit tests elsewhere prove this arithmetic is self-consistent, which is a
 * weaker claim than it sounds: a transform can round-trip perfectly and still
 * disagree with where pdf.js actually draws, and then every highlight sits a few
 * points from the words it was meant to cover. pdf.js exposes the same
 * conversion through `convertToViewportRectangle`, so the two can be compared
 * directly on real page geometry rather than on numbers chosen to be tidy.
 */

const PAPER = fileURLToPath(
	new URL('../../../tests/fixtures/retrieval/papers/1907.11692v1.pdf', import.meta.url)
);

const available = existsSync(PAPER);

interface Viewport {
	transform: number[];
	convertToViewportRectangle(rect: number[]): number[];
}

let page1: {
	getViewport(options: { scale: number; rotation?: number }): Viewport;
	getTextContent(): Promise<{ items: unknown[] }>;
};

/** The box a pdf.js text item occupies, in PDF user space. */
function boxOf(item: { transform: number[]; width: number; height: number }): Rect {
	return {
		x: item.transform[4],
		y: item.transform[5],
		w: item.width,
		h: item.height
	};
}

describe.skipIf(!available)('anchoring against real page geometry', () => {
	let items: Array<{ transform: number[]; width: number; height: number; str: string }>;

	beforeAll(async () => {
		const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
		pdfjs.GlobalWorkerOptions.workerSrc = path.resolve(
			'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
		);

		const bytes = new Uint8Array(await readFile(PAPER));
		const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
		page1 = await doc.getPage(1);

		const content = await page1.getTextContent();
		items = content.items.filter(
			(item): item is { transform: number[]; width: number; height: number; str: string } =>
				typeof item === 'object' &&
				item !== null &&
				'width' in item &&
				(item as { width: number }).width > 0
		);
	});

	it('found real text to measure against', () => {
		expect(items.length).toBeGreaterThan(50);
	});

	it('agrees with pdf.js about where a word goes, at every zoom', () => {
		// The claim that matters: our transform and pdf.js's put the same word in
		// the same place. If these ever diverge, highlights drift from the text by
		// a margin that grows with the zoom.
		for (const scale of [0.5, 1, 1.5, 2, 4]) {
			const viewport = page1.getViewport({ scale });

			for (const item of items.slice(0, 40)) {
				const box = boxOf(item);
				const mine = rectToView(box, { transform: viewport.transform });

				const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
					box.x,
					box.y,
					box.x + box.w,
					box.y + box.h
				]);

				expect(mine.left).toBeCloseTo(Math.min(x1, x2), 6);
				expect(mine.top).toBeCloseTo(Math.min(y1, y2), 6);
				expect(mine.width).toBeCloseTo(Math.abs(x2 - x1), 6);
				expect(mine.height).toBeCloseTo(Math.abs(y2 - y1), 6);
			}
		}
	});

	it('agrees on a rotated page too', () => {
		// Scanned papers and some journal proofs carry a rotation, and a y-flip
		// plus a rotation is where corner handling stops being obvious.
		for (const rotation of [90, 180, 270]) {
			const viewport = page1.getViewport({ scale: 1.5, rotation });
			const box = boxOf(items[10]);

			const mine = rectToView(box, { transform: viewport.transform });
			const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
				box.x,
				box.y,
				box.x + box.w,
				box.y + box.h
			]);

			expect(mine.left).toBeCloseTo(Math.min(x1, x2), 6);
			expect(mine.top).toBeCloseTo(Math.min(y1, y2), 6);
			expect(mine.width).toBeCloseTo(Math.abs(x2 - x1), 6);
			expect(mine.height).toBeCloseTo(Math.abs(y2 - y1), 6);
		}
	});

	it('recovers a real word from where it was drawn', () => {
		// The path a highlight actually takes: the browser reports a rectangle on
		// screen, it is stored in user space, and it has to come back to the same
		// words. Run on a real glyph box rather than a round number.
		const viewport = page1.getViewport({ scale: 1.75 });
		const box = boxOf(items[20]);

		const onScreen = rectToView(box, { transform: viewport.transform });
		const stored = viewRectToPdf(onScreen, { transform: viewport.transform });

		expect(stored.x).toBeCloseTo(box.x, 5);
		expect(stored.y).toBeCloseTo(box.y, 5);
		expect(stored.w).toBeCloseTo(box.w, 5);
		expect(stored.h).toBeCloseTo(box.h, 5);
	});

	it('anchors a selection over several words back onto those words', () => {
		// A whole line, the way a reader would take it: several runs on one line,
		// converted through the page frame and merged, then measured against the
		// span they came from.
		const viewport = page1.getViewport({ scale: 1.25 });
		const frame = {
			page: 1,
			// A page sitting 30 across and 80 down inside the scrolling content.
			bounds: { left: 30, top: 80, width: 600, height: 850 },
			viewport: { transform: viewport.transform }
		};

		const line = items.slice(4, 8).map((item) => {
			const view = rectToView(boxOf(item), { transform: viewport.transform });
			return {
				left: view.left + frame.bounds.left,
				top: view.top + frame.bounds.top,
				width: view.width,
				height: view.height
			};
		});

		const anchored = clientRectsToPdf(line, frame);
		expect(anchored.length).toBeGreaterThan(0);

		const wanted = line.reduce(
			(acc, r) => ({
				left: Math.min(acc.left, r.left),
				right: Math.max(acc.right, r.left + r.width)
			}),
			{ left: Infinity, right: -Infinity }
		);

		const got = anchored.reduce(
			(acc, r) => {
				const view = rectToView(r, { transform: viewport.transform });
				return {
					left: Math.min(acc.left, view.left + frame.bounds.left),
					right: Math.max(acc.right, view.left + view.width + frame.bounds.left)
				};
			},
			{ left: Infinity, right: -Infinity }
		);

		// Within a pixel: the merge rounds edges together, it does not move them.
		expect(got.left).toBeCloseTo(wanted.left, 1);
		expect(got.right).toBeCloseTo(wanted.right, 1);
	});
});
