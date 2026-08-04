import { describe, expect, it } from 'vitest';

import { chunkPages, isHeading, splitSentences } from './chunk';
import type { ExtractedPage, Line } from './extract';

function line(text: string, page = 1, fontSize = 10): Line {
	return { text, x: 50, y: 700, right: 300, fontSize, fontName: 'f1', page };
}

function pagesOf(...pages: Line[][]): ExtractedPage[] {
	return pages.map((lines, i) => ({ page: i + 1, lines, columns: 1 }));
}

/**
 * Enough prose to force several chunks at the default target.
 *
 * Sentences start with a capital, as real prose does — the splitter requires one
 * after the full stop, so that a decimal or an abbreviation cannot be mistaken
 * for a boundary.
 */
const OPENERS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'] as const;

const paragraph = (marker: string) =>
	OPENERS.map(
		(opener) =>
			`${opener} findings for ${marker} carry enough words here to take up a reasonable amount of room.`
	).join(' ');

describe('sentence splitting', () => {
	it('does not break on an abbreviation', () => {
		// "et al." mid-sentence shattered chunks with a naive split.
		expect(splitSentences('Smith et al. showed a clear effect. Others disagreed.')).toEqual([
			'Smith et al. showed a clear effect.',
			'Others disagreed.'
		]);
	});

	it('does not break on initials', () => {
		expect(splitSentences('Work by J. R. Smith settled it. Then it changed.')).toEqual([
			'Work by J. R. Smith settled it.',
			'Then it changed.'
		]);
	});

	it('does not break inside a decimal', () => {
		expect(splitSentences('The model explained 0.95 of the variance. That is high.')).toEqual([
			'The model explained 0.95 of the variance.',
			'That is high.'
		]);
	});

	it('splits on real sentence boundaries', () => {
		expect(splitSentences('One claim. Another claim! A third? Yes.')).toHaveLength(4);
	});
});

describe('heading detection', () => {
	it('recognises a named section', () => {
		expect(isHeading(line('Introduction'), 10)).toBe(true);
		expect(isHeading(line('3.2 Experimental Setup'), 10)).toBe(true);
	});

	it('recognises a heading by its larger type', () => {
		expect(isHeading(line('A Novel Approach', 1, 14), 10)).toBe(true);
	});

	it('does not mistake a sentence for a heading', () => {
		expect(isHeading(line('We evaluate the model on three datasets.'), 10)).toBe(false);
	});

	it('does not mistake a figure caption for a heading', () => {
		expect(isHeading(line('Figure 2. Residual learning: a building block.'), 10)).toBe(false);
	});
});

describe('chunking', () => {
	it('records the page and section a chunk came from', () => {
		// These are what make "p. 4, Results" possible in a result list, and what
		// #37 needs to jump to the right place in the PDF.
		const chunks = chunkPages(pagesOf([line('Introduction', 1, 14), line(paragraph('intro'), 1)]));

		expect(chunks.length).toBeGreaterThan(0);
		expect(chunks[0].section).toBe('Introduction');
		expect(chunks[0].pageStart).toBe(1);
		expect(chunks[0].charEnd).toBeGreaterThan(chunks[0].charStart);
	});

	it('cuts the reference list', () => {
		// A bibliography is dense with author names, titles and years, so its
		// chunks match anything citation-shaped and cost precision.
		const chunks = chunkPages(
			pagesOf(
				[line('Discussion', 1, 14), line(paragraph('body'), 1)],
				[
					line('References', 2, 14),
					line('Smith, A. (2020). Coastal erosion. Journal of Coastal Research 36, 101-118.', 2),
					line('Jones, B. (2019). Tidal prediction. Ocean Modelling 88, 12-30.', 2)
				]
			)
		);

		const text = chunks.map((c) => c.text).join(' ');
		expect(text).toContain('findings for body');
		expect(text).not.toContain('Coastal erosion');
		expect(text).not.toContain('Ocean Modelling');
	});

	it('keeps the reference list when asked to', () => {
		const chunks = chunkPages(
			pagesOf([line('References', 1, 14), line('Smith, A. (2020). Coastal erosion.', 1)]),
			{ excludeReferences: false }
		);

		expect(chunks.map((c) => c.text).join(' ')).toContain('Coastal erosion');
	});

	it('keeps chunks near the target size', () => {
		// The tokenizer truncates at 128 tokens — roughly 500 characters — so
		// anything much larger is silently discarded before it reaches the model.
		const chunks = chunkPages(pagesOf([line(paragraph('body'), 1)]), { targetChars: 300 });

		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.text.length).toBeLessThan(600);
		}
	});

	it('overlaps consecutive chunks so a boundary match survives', () => {
		// With no overlap, a passage straddling two chunks matched neither.
		const chunks = chunkPages(pagesOf([line(paragraph('body'), 1)]), {
			targetChars: 200,
			overlap: 0.3
		});

		expect(chunks.length).toBeGreaterThan(1);
		// The last sentence of one chunk opens the next.
		const lastSentence = chunks[0].text.split('. ').at(-1)!;
		expect(chunks[1].text.startsWith(lastSentence.slice(0, 20))).toBe(true);
	});

	it('does not overlap when overlap is zero', () => {
		const chunks = chunkPages(pagesOf([line(paragraph('body'), 1)]), {
			targetChars: 200,
			overlap: 0
		});

		const lastSentence = chunks[0].text.split('. ').at(-1)!;
		expect(chunks[1].text).not.toContain(lastSentence.slice(0, 20));
	});

	it('separates text under different headings', () => {
		const chunks = chunkPages(
			pagesOf([
				line('Methods', 1, 14),
				line('We fitted a linear model to the data.', 1),
				line('Results', 1, 14),
				line('The effect was significant.', 1)
			])
		);

		const sections = chunks.map((c) => c.section);
		expect(sections).toContain('Methods');
		expect(sections).toContain('Results');
		// A chunk never mixes two sections.
		const methods = chunks.find((c) => c.section === 'Methods');
		expect(methods!.text).not.toContain('significant');
	});

	it('tracks pages across a section that spans a page break', () => {
		const chunks = chunkPages(
			pagesOf(
				[line('Results', 1, 14), line('The first part of the finding is here.', 1)],
				[line('The second part continues onto the next page.', 2)]
			)
		);

		expect(chunks[0].pageStart).toBe(1);
		expect(chunks[0].pageEnd).toBe(2);
	});

	it('returns nothing for an empty document', () => {
		expect(chunkPages([])).toEqual([]);
		expect(chunkPages(pagesOf([]))).toEqual([]);
	});
});
