import { describe, expect, it } from 'vitest';

import {
	extractPages,
	findColumnGutter,
	pagesToText,
	stripRunningHeadersAndFooters,
	type ExtractedPage,
	type TextItemLike
} from './extract';

/**
 * Builds a pdf.js-shaped text item. Only x, width and the string matter for most
 * of these; y separates lines.
 */
function item(
	str: string,
	x: number,
	y: number,
	width = str.length * 5,
	height = 10
): TextItemLike {
	return { str, transform: [1, 0, 0, 1, x, y], width, height, fontName: 'f1' };
}

/** A fake pdf.js document over pre-built pages of items. */
function fakeDoc(pages: TextItemLike[][]) {
	return {
		numPages: pages.length,
		getPage: async (n: number) => ({
			getTextContent: async () => ({ items: pages[n - 1] }),
			cleanup: () => {}
		})
	};
}

describe('word boundaries', () => {
	// The defect this guards: production joined positioned runs with '', so real
	// output read "theobserved effect" and every embedding was computed on it.
	it('inserts a space where the geometry shows a gap', async () => {
		const pages = await extractPages(
			fakeDoc([
				[item('the', 50, 700, 15), item('observed', 70, 700, 40), item('effect', 115, 700, 30)]
			])
		);

		expect(pagesToText(pages)).toBe('the observed effect');
	});

	it('does not insert a space mid-word when a run is split', async () => {
		// pdf.js splits on font changes, so an italicised fragment arrives as its
		// own item butted directly against the previous one.
		const pages = await extractPages(
			fakeDoc([[item('inter', 50, 700, 25), item('national', 75, 700, 40)]])
		);

		expect(pagesToText(pages)).toBe('international');
	});

	it('does not double a space that is already there', async () => {
		const pages = await extractPages(
			fakeDoc([[item('one ', 50, 700, 22), item('two', 80, 700, 15)]])
		);

		expect(pagesToText(pages)).toBe('one two');
	});
});

describe('line and page assembly', () => {
	it('orders lines down the page, not by content-stream order', async () => {
		// pdf.js emits items in drawing order; here the lower line is drawn first.
		const pages = await extractPages(
			fakeDoc([[item('second', 50, 600, 30), item('first', 50, 700, 25)]])
		);

		expect(pagesToText(pages)).toBe('first second');
	});

	it('rejoins a word hyphenated across a line break', async () => {
		const pages = await extractPages(
			fakeDoc([[item('distri-', 50, 700, 35), item('bution', 50, 685, 30)]])
		);

		expect(pagesToText(pages)).toBe('distribution');
	});

	it('keeps a real hyphenated compound intact', async () => {
		const pages = await extractPages(
			fakeDoc([[item('state-of-the-art', 50, 700, 80), item('results', 50, 685, 35)]])
		);

		expect(pagesToText(pages)).toBe('state-of-the-art results');
	});
});

describe('column detection', () => {
	/** A two-column page: text at x≈50 and x≈310, gutter around 300. */
	function twoColumnItems(): TextItemLike[] {
		const items: TextItemLike[] = [];
		for (let row = 0; row < 15; row++) {
			items.push(item(`left${row}`, 50, 700 - row * 15, 200));
			items.push(item(`right${row}`, 310, 700 - row * 15, 200));
		}
		return items;
	}

	it('finds the gutter on a two-column page', () => {
		const gutter = findColumnGutter(twoColumnItems());

		expect(gutter).not.toBeNull();
		expect(gutter!).toBeGreaterThan(250);
		expect(gutter!).toBeLessThan(310);
	});

	it('reads each column through before starting the next', async () => {
		const pages = await extractPages(fakeDoc([twoColumnItems()]));
		const text = pagesToText(pages);

		expect(pages[0].columns).toBe(2);
		// Every left-column line precedes every right-column line.
		expect(text.indexOf('left14')).toBeLessThan(text.indexOf('right0'));
	});

	it('is not fooled by a stray item sitting in the gutter', () => {
		// A real two-column paper had a single equation number parked in the
		// gutter, which defeated an "empty band" test entirely.
		const items = [...twoColumnItems(), item('2', 295, 500, 5)];

		expect(findColumnGutter(items)).not.toBeNull();
	});

	it('reports a single column for ordinary prose', () => {
		const items = Array.from({ length: 30 }, (_, row) =>
			item(`a full width line of prose number ${row}`, 50, 700 - row * 15, 460)
		);

		expect(findColumnGutter(items)).toBeNull();
	});

	it('does not split a page with too little text to judge', () => {
		expect(findColumnGutter([item('title', 50, 700, 100)])).toBeNull();
	});
});

describe('running headers and footers', () => {
	function pageWith(n: number, lines: string[]): ExtractedPage {
		return {
			page: n,
			columns: 1,
			lines: lines.map((text, i) => ({
				text,
				x: 50,
				y: 700 - i * 15,
				right: 300,
				fontSize: 10,
				fontName: 'f1',
				page: n
			}))
		};
	}

	it('drops a running head that repeats across pages', () => {
		const pages = [1, 2, 3, 4, 5, 6].map((n) =>
			pageWith(n, ['Journal of Coastal Research', `body text on page ${n}`, `${n}`])
		);

		const stripped = stripRunningHeadersAndFooters(pages);
		const text = stripped.flatMap((p) => p.lines.map((l) => l.text)).join(' ');

		expect(text).not.toContain('Journal of Coastal Research');
		expect(text).toContain('body text on page 3');
	});

	it('masks digits so page numbers count as the same footer', () => {
		// A realistic page depth: the edge windows are two lines, so the body in
		// between is never a candidate.
		const pages = [1, 2, 3, 4, 5, 6].map((n) =>
			pageWith(n, [
				'Journal of Coastal Research',
				`heading ${n}`,
				'body one',
				'body two',
				'body three',
				'body four',
				'body five',
				'body six',
				`figure caption ${n}`,
				`Page ${n} of 6`
			])
		);

		const stripped = stripRunningHeadersAndFooters(pages);
		const text = stripped.flatMap((p) => p.lines.map((l) => l.text)).join(' ');

		expect(text).not.toContain('Page 3 of 6');
		expect(text).toContain('body three');
	});

	it('leaves a short document alone', () => {
		// Two pages is not enough evidence that a repeated line is furniture.
		const pages = [1, 2].map((n) => pageWith(n, ['Shared Heading', `body ${n}`]));

		expect(stripRunningHeadersAndFooters(pages)).toEqual(pages);
	});

	it('does not drop body text that merely recurs mid-page', () => {
		const pages = [1, 2, 3, 4, 5, 6].map((n) =>
			pageWith(n, [`head ${n}`, 'a repeated middle line', 'more body', `foot ${n}`])
		);

		const stripped = stripRunningHeadersAndFooters(pages);
		const text = stripped.flatMap((p) => p.lines.map((l) => l.text)).join(' ');

		expect(text).toContain('a repeated middle line');
	});
});
