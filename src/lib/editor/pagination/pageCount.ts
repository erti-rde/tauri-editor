import { writable } from 'svelte/store';

/**
 * How many pages there are.
 *
 * The library substitutes `{page}` — as a span backed by a CSS counter — and
 * does not substitute `{total}` at all, despite documenting it. A footer
 * reading "Page 3 of {total}" is worse than no footer, so the count is
 * maintained here.
 *
 * There is no CSS for this: counters can say which page this is, because that
 * is a running total, but nothing can say how many there will be until the last
 * one has been laid out. So it is counted from the DOM after the paginator has
 * finished, and published both as a store — for the status bar — and as a
 * custom property the running heads read through `content`.
 */

export const PAGE_TOTAL_PROPERTY = '--erti-page-total';

/** The class `{total}` is replaced with, whose ::after reads the property. */
export const PAGE_TOTAL_CLASS = 'erti-page-total';

/**
 * Pages in the open manuscript. 1 before anything is measured, because a
 * document always has at least one page and "0 pages" is never true.
 */
export const pageCount = writable(1);

/**
 * One `.rm-page-break` per page, not per boundary between them.
 *
 * Measured rather than assumed, after this reported one page too many: a
 * three-paragraph document that fits on a single sheet renders exactly one
 * break and one footer, and a document filling two sheets renders two of each.
 * The element is a spacer that *makes* a page rather than a rule drawn between
 * two, so adding one for "the last page" counts a page that is not there.
 *
 * The floor is 1 because an unpaginated document has no breaks at all, and no
 * document has ever had nought pages.
 */
export function countPages(root: Element): number {
	return Math.max(1, root.querySelectorAll('.rm-page-break').length);
}

/**
 * Watch an editor's DOM and keep the count current.
 *
 * A MutationObserver rather than an editor update handler: pagination runs
 * after measurement, asynchronously, so the count is wrong at the moment the
 * transaction lands and right a frame later.
 *
 * Returns a teardown, which the caller must run — an observer on a destroyed
 * editor keeps the whole document tree alive.
 */
export function observePageCount(root: HTMLElement): () => void {
	let frame = 0;

	const publish = () => {
		frame = 0;
		const total = countPages(root);
		pageCount.set(total);
		// A string, because `content` takes one. `content: var(--x)` with a number
		// is invalid and silently renders nothing.
		root.style.setProperty(PAGE_TOTAL_PROPERTY, `"${total}"`);
	};

	const observer = new MutationObserver(() => {
		// Coalesced: laying out a long document mutates the tree hundreds of
		// times, and counting on each one is the difference between a smooth
		// re-pagination and a visible stall.
		if (frame) return;
		frame = requestAnimationFrame(publish);
	});

	observer.observe(root, { childList: true, subtree: true });
	publish();

	return () => {
		observer.disconnect();
		if (frame) cancelAnimationFrame(frame);
	};
}

/**
 * Swap `{total}` for something that can display a number CSS does not know yet.
 *
 * Applied before the string reaches the library, which handles `{page}` itself.
 */
export function substituteTotal(template: string): string {
	return template.replaceAll('{total}', `<span class="${PAGE_TOTAL_CLASS}"></span>`);
}
