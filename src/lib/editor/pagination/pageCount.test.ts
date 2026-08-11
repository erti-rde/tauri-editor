import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

import {
	PAGE_TOTAL_CLASS,
	PAGE_TOTAL_PROPERTY,
	countPages,
	observePageCount,
	pageCount,
	substituteTotal
} from './pageCount';

/**
 * "Page 3 of 12", which the library will not produce.
 *
 * It substitutes `{page}` and, despite documenting it, leaves `{total}` in the
 * markup verbatim — the footer rendered "Page 3 of {total}" on a real document,
 * which is worse than having no footer.
 */

function pagedRoot(breaks: number): HTMLElement {
	const root = document.createElement('div');
	for (let i = 0; i < breaks; i++) {
		const brk = document.createElement('div');
		brk.className = 'rm-page-break';
		root.appendChild(brk);
	}
	document.body.appendChild(root);
	return root;
}

afterEach(() => {
	document.body.innerHTML = '';
	pageCount.set(1);
});

describe('counting the pages', () => {
	it('counts one page per break, not one per boundary between them', () => {
		// This read `breaks + 1` and reported a page too many on every document.
		// Measured in a browser: a three-paragraph manuscript that fits on one
		// sheet renders exactly one break and one footer, and one filling two
		// sheets renders two of each. The element is a spacer whose height *is* a
		// page rather than a rule drawn between two.
		expect(countPages(pagedRoot(1))).toBe(1);
		expect(countPages(pagedRoot(3))).toBe(3);
	});

	it('calls an unbroken document one page', () => {
		// Pagination turned off leaves no breaks at all, and no document has ever
		// had nought pages.
		expect(countPages(pagedRoot(0))).toBe(1);
	});
});

describe('publishing the count', () => {
	it('sets the store and the property up front', () => {
		const root = pagedRoot(3);

		const stop = observePageCount(root);

		expect(get(pageCount)).toBe(3);
		// Quoted: `content` takes a string, and `content: var(--x)` holding a bare
		// number is invalid and renders nothing at all.
		expect(root.style.getPropertyValue(PAGE_TOTAL_PROPERTY)).toBe('"3"');

		stop();
	});

	it('follows the document as it grows', async () => {
		const root = pagedRoot(2);
		const stop = observePageCount(root);
		expect(get(pageCount)).toBe(2);

		const brk = document.createElement('div');
		brk.className = 'rm-page-break';
		root.appendChild(brk);

		// The observer coalesces onto a frame, because laying out a long document
		// mutates the tree hundreds of times and counting on each is a visible
		// stall.
		await vi.waitFor(() => expect(get(pageCount)).toBe(3));
		expect(root.style.getPropertyValue(PAGE_TOTAL_PROPERTY)).toBe('"3"');

		stop();
	});

	it('stops counting once torn down', async () => {
		const root = pagedRoot(2);
		const stop = observePageCount(root);
		stop();

		const brk = document.createElement('div');
		brk.className = 'rm-page-break';
		root.appendChild(brk);

		// An observer left running on a destroyed editor keeps the whole document
		// tree alive, and would report a count for a manuscript nobody has open.
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(get(pageCount)).toBe(2);
	});
});

describe('substituting {total}', () => {
	it('leaves something CSS can fill in', () => {
		expect(substituteTotal('Page {page} of {total}')).toBe(
			`Page {page} of <span class="${PAGE_TOTAL_CLASS}"></span>`
		);
	});

	it('leaves {page} for the library, which does handle it', () => {
		expect(substituteTotal('Page {page}')).toBe('Page {page}');
	});

	it('replaces every occurrence', () => {
		const out = substituteTotal('{total} — {total}');

		expect(out.match(new RegExp(PAGE_TOTAL_CLASS, 'g'))).toHaveLength(2);
	});

	it('leaves a running head with no placeholders alone', () => {
		expect(substituteTotal('Confidential')).toBe('Confidential');
		expect(substituteTotal('')).toBe('');
	});
});
