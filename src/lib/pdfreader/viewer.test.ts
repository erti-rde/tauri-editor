import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * pdf.js is stubbed here, not exercised: it cannot render in jsdom, and its own
 * behaviour is its own business. What is worth pinning down is the wiring around
 * it — the two places where pdf.js's defaults are wrong for this application,
 * and where getting it wrong looks like the reader is broken rather than
 * misconfigured.
 */

const observers = vi.hoisted(() => [] as Array<() => void>);
const buses = vi.hoisted(
	() => [] as Array<{ dispatch: (name: string, payload?: unknown) => void }>
);

class StubResizeObserver {
	constructor(private callback: () => void) {
		observers.push(callback);
	}
	observe() {}
	disconnect() {}
}
vi.stubGlobal('ResizeObserver', StubResizeObserver);

/** Enough of pdf.js's EventBus to carry the handlers the viewer registers. */
class StubEventBus {
	handlers = new Map<string, Set<(payload: unknown) => void>>();

	constructor() {
		buses.push(this);
	}

	on(name: string, handler: (payload: unknown) => void) {
		if (!this.handlers.has(name)) this.handlers.set(name, new Set());
		this.handlers.get(name)!.add(handler);
	}

	off(name: string, handler: (payload: unknown) => void) {
		this.handlers.get(name)?.delete(handler);
	}

	dispatch(name: string, payload: unknown = {}) {
		for (const handler of [...(this.handlers.get(name) ?? [])]) handler(payload);
	}
}

const viewerStub = vi.hoisted(() => ({
	currentPageNumber: 1,
	currentScale: 1,
	currentScaleValue: 'auto' as string,
	pagesCount: 10,
	setDocument: vi.fn(),
	scrollPageIntoView: vi.fn(),
	getPageView: vi.fn(),
	update: vi.fn()
}));

vi.mock('pdfjs-dist', () => ({
	GlobalWorkerOptions: {},
	getDocument: vi.fn(() => ({ promise: Promise.resolve({ numPages: 10, destroy: vi.fn() }) }))
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.mjs' }));
vi.mock('pdfjs-dist/web/pdf_viewer.css', () => ({}));
vi.mock('pdfjs-dist/web/pdf_viewer.mjs', () => ({
	EventBus: StubEventBus,
	FindState: { FOUND: 0, NOT_FOUND: 1, WRAPPED: 2, PENDING: 3 },
	PDFLinkService: class {
		setViewer() {}
		setDocument() {}
	},
	PDFFindController: class {},
	PDFViewer: class {
		constructor() {
			return viewerStub;
		}
	},
	// The same numbering pdf.js uses, because the reader stores these values and
	// a stub with different ones would let a swapped pair pass.
	ScrollMode: { VERTICAL: 0, HORIZONTAL: 1, WRAPPED: 2, PAGE: 3 },
	SpreadMode: { NONE: 0, ODD: 1, EVEN: 2 }
}));

const { createReaderViewer } = await import('./viewer');

function mounted() {
	const container = document.createElement('div');
	container.appendChild(document.createElement('div'));
	return createReaderViewer(container as HTMLDivElement);
}

beforeEach(() => {
	vi.clearAllMocks();
	observers.length = 0;
	buses.length = 0;
	viewerStub.currentPageNumber = 1;
	viewerStub.currentScaleValue = 'auto';
});

describe('jumping to a passage', () => {
	it('goes to the page it was asked for', async () => {
		const reader = mounted();
		await reader.load(new Uint8Array([1]));

		reader.goTo({ page: 5 });

		expect(viewerStub.currentPageNumber).toBe(5);
	});

	it('keeps the page it was asked for when the search lands elsewhere', async () => {
		// pdf.js searches the whole document and scrolls to its first match, which
		// need not be on the page asked for: a passage on page 5 whose wording also
		// appears on page 7 lands on page 7, and the citation looks wrong. The page
		// came from the chunk that produced the quote, so it is the better of the
		// two — the search is there to mark the words, not to choose the page.
		const reader = mounted();
		await reader.load(new Uint8Array([1]));

		reader.goTo({ page: 5, selector: { quote: 'the effect was strongest' } });

		const bus = buses[0];

		// The search starts. Nothing has moved yet, and nothing should be undone.
		bus.dispatch('updatefindcontrolstate', { state: 3 });
		expect(viewerStub.currentPageNumber).toBe(5);

		// pdf.js finds a match on another page and scrolls there.
		viewerStub.currentPageNumber = 7;
		bus.dispatch('updatefindcontrolstate', { state: 0 });

		expect(viewerStub.currentPageNumber).toBe(5);
	});

	it('leaves the page alone when the search agrees with it', async () => {
		const reader = mounted();
		await reader.load(new Uint8Array([1]));

		reader.goTo({ page: 5, selector: { quote: 'the effect was strongest' } });
		buses[0].dispatch('updatefindcontrolstate', { state: 0 });

		expect(viewerStub.currentPageNumber).toBe(5);
	});

	it('stops watching once the search has settled, so scrolling away still works', async () => {
		const reader = mounted();
		await reader.load(new Uint8Array([1]));

		reader.goTo({ page: 5, selector: { quote: 'the effect was strongest' } });
		buses[0].dispatch('updatefindcontrolstate', { state: 0 });

		// The reader then scrolls somewhere themselves; a later search must not
		// drag them back to where a citation once pointed.
		viewerStub.currentPageNumber = 9;
		buses[0].dispatch('updatefindcontrolstate', { state: 0 });

		expect(viewerStub.currentPageNumber).toBe(9);
	});

	it('uses the stored rectangles when it has them, so it lands on the passage', async () => {
		const reader = mounted();
		await reader.load(new Uint8Array([1]));

		reader.goTo({ page: 5, rects: [{ x: 72, y: 600, w: 400, h: 12 }] });

		expect(viewerStub.scrollPageIntoView).toHaveBeenCalledWith(
			expect.objectContaining({ pageNumber: 5 })
		);
	});

	it('will not scroll past the end of the paper', async () => {
		const reader = mounted();
		await reader.load(new Uint8Array([1]));

		reader.goTo({ page: 999 });

		expect(viewerStub.currentPageNumber).toBe(10);
	});
});

describe('when the pane changes size', () => {
	it('refits a paper that is fitted to the container', async () => {
		// 'auto' and 'page-width' are statements about the container, and this
		// container is a workspace pane. Dragging the split divider resizes it
		// without a window resize, and pdf.js's own observer only updates a CSS
		// height variable — it never recomputes the scale. Without this, a paper
		// opened full width stays full width in half a pane, cut off on the right.
		const reader = mounted();
		await reader.load(new Uint8Array([1]));

		viewerStub.currentScaleValue = 'page-width';
		observers.forEach((fire) => fire());

		expect(viewerStub.currentScaleValue).toBe('page-width');
		expect(viewerStub.update).toHaveBeenCalled();
	});

	it('leaves a zoom the reader chose alone', async () => {
		// Only a named value is relative to the container. Someone who zoomed to
		// 150% to read a figure meant 150%, and should not lose it because the
		// pane moved.
		const reader = mounted();
		await reader.load(new Uint8Array([1]));

		viewerStub.currentScaleValue = '1.5';
		const setScale = vi.spyOn(viewerStub, 'currentScaleValue', 'set');

		observers.forEach((fire) => fire());

		expect(setScale).not.toHaveBeenCalled();
		setScale.mockRestore();
	});

	it('does nothing before a document is loaded', () => {
		mounted();
		const setScale = vi.spyOn(viewerStub, 'currentScaleValue', 'set');

		observers.forEach((fire) => fire());

		expect(setScale).not.toHaveBeenCalled();
		setScale.mockRestore();
	});
});
