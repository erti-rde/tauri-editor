// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { pageTextFrom } from './pageText';

/**
 * Run against a real two-column arXiv paper rather than a fixture of pdf.js
 * output, because the failures this guards against are exactly the ones a
 * hand-made fixture cannot have: runs that need a space between them, and two
 * columns a naive reading splices together line by line.
 *
 * It doubles as the check that pdf.js is wired correctly at all — the worker,
 * the document load, the text content — which the rest of the reader cannot
 * assert without a browser.
 */

const PAPER = fileURLToPath(
	new URL('../../../tests/fixtures/retrieval/papers/1907.11692v1.pdf', import.meta.url)
);

// A fresh clone has no corpus and still runs green, the way the metadata
// health check does.
const available = existsSync(PAPER);

let document: { numPages: number };

describe.skipIf(!available)('reading one page of a real paper', () => {
	beforeAll(async () => {
		const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
		pdfjs.GlobalWorkerOptions.workerSrc = path.resolve(
			'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
		);

		const bytes = new Uint8Array(await readFile(PAPER));
		document = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
	});

	it('loads the document at all', () => {
		expect(document.numPages).toBeGreaterThan(1);
	});

	it('produces text with words in it', async () => {
		const text = await pageTextFrom(document as never, 1);

		expect(text.length).toBeGreaterThan(500);
		expect(text).toMatch(/RoBERTa/i);
	});

	it('puts spaces between runs that need them', async () => {
		// The defect this guards against joined pdf.js text items with the empty
		// string, so real output contained "theobserved effect".
		//
		// Measured over prose words only. This page legitimately carries a 40-
		// character author email list, a GitHub URL and an arXiv identifier, none
		// of which say anything about whether runs were joined — the longest real
		// word on it is "state-of-the-art".
		const text = await pageTextFrom(document as never, 1);
		const words = text.split(/\s+/).filter((word) => /^[A-Za-z-]+$/.test(word));
		const longest = words.reduce((a, b) => (a.length > b.length ? a : b), '');

		expect(longest.length).toBeLessThan(25);
		// And the positive form of the same check, on a phrase this paper has.
		expect(text).toMatch(/language model pretraining/i);
	});

	it('reads a two-column page without splicing the columns together', async () => {
		// Grouping by baseline before resolving columns interleaves the left
		// column's text into the right column's lines, which reads as fluent
		// nonsense and is invisible in a word count.
		const text = await pageTextFrom(document as never, 2);

		expect(text.split(/\s+/).filter(Boolean).length).toBeGreaterThan(100);
		// A run of ordinary words surviving intact is the evidence: interleaved
		// columns leave almost no long lowercase phrase contiguous.
		expect(text).toMatch(/[a-z]+ [a-z]+ [a-z]+ [a-z]+ [a-z]+/);
	});

	it('gives different pages different text', async () => {
		const [first, second] = await Promise.all([
			pageTextFrom(document as never, 1),
			pageTextFrom(document as never, 2)
		]);

		expect(first).not.toBe(second);
	});
});
