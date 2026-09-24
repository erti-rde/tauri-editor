import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';
import { tick } from 'svelte';

import Harness from './PdfReaderHarness.svelte';
import { readerStore } from './readerStore';
import { annotationsStore } from '$lib/stores/annotations.svelte';
import type { ViewerCallbacks } from './viewer';

/**
 * pdf.js is mocked at the `viewer.ts` boundary rather than deeper, so these
 * exercise the reader's own wiring — the load race, what reaches the store, and
 * what happens on teardown — without asserting anything about pdf.js, which has
 * its own tests and cannot render in jsdom anyway.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const viewer = vi.hoisted(() => ({
	load: vi.fn(),
	goToPage: vi.fn(),
	goTo: vi.fn(),
	setZoom: vi.fn(),
	zoomBy: vi.fn(),
	find: vi.fn(),
	clearFind: vi.fn(),
	pageText: vi.fn(),
	pageLines: vi.fn(async () => []),
	pageAnnotations: vi.fn(async () => []),
	viewportFor: vi.fn(),
	frameFor: vi.fn(),
	cropPage: vi.fn(async () => null),
	setScrollMode: vi.fn(),
	setSpreadMode: vi.fn(),
	rotateBy: vi.fn(),
	pageLabels: vi.fn(async (): Promise<(string | null)[] | null> => null),
	place: vi.fn(() => ({ page: 1, top: 0, left: 0, scale: 1 })),
	goToPlace: vi.fn(),
	destroy: vi.fn(),
	scale: 1,
	pages: 0,
	page: 1,
	rotation: 0,
	scrollMode: 'vertical' as const,
	spreadMode: 'none' as const
}));

/** The callbacks the reader handed the viewer, so a test can fire them. */
const captured = vi.hoisted(() => ({ current: {} as ViewerCallbacks }));

const db = vi.hoisted(() => ({
	sourceForPath: vi.fn(),
	annotationsForSource: vi.fn(),
	annotationLabels: vi.fn(),
	saveAnnotation: vi.fn(),
	deleteAnnotation: vi.fn(),
	embedAnnotation: vi.fn(async () => false),
	saveAnnotationImage: vi.fn(),
	nameLabelsAfterColours: vi.fn(async () => 8),
	saveLabel: vi.fn()
}));
vi.mock('$lib/stores/db', () => db);

vi.mock('@tauri-apps/plugin-store', () => ({
	load: vi.fn(async () => ({ get: vi.fn(async () => undefined), set: vi.fn(), save: vi.fn() }))
}));

vi.mock('./viewer', () => ({
	createReaderViewer: (_element: HTMLElement, callbacks: ViewerCallbacks) => {
		captured.current = callbacks;
		return viewer;
	}
}));

/**
 * A left-button press on the pages.
 *
 * `fireEvent.pointerDown` cannot be used for this: jsdom implements no
 * `PointerEvent`, so testing-library falls back to a plain `Event` and
 * `event.button` arrives undefined — which the reader reads as "not the left
 * button" and ignores, exactly as it should for a right-click. A `MouseEvent`
 * carries a real button and is what the webview delivers.
 */
function pointerOn(element: Element, type: string, at: { x: number; y: number }) {
	element.dispatchEvent(
		new MouseEvent(type, {
			bubbles: true,
			cancelable: true,
			button: 0,
			clientX: at.x,
			clientY: at.y
		})
	);
}

const pressOn = (element: Element, at: { x: number; y: number }) =>
	pointerOn(element, 'pointerdown', at);

/** The right-hand end of MARK, where its closing caret is drawn. */
const END_OF_THE_MARK = { x: 210, y: 94 };

/**
 * Where MARK is drawn, in the scrolling content's coordinates.
 *
 * Its rectangle is x 10–210 and y 700–712 in PDF user space; the frame flips y
 * about 800, so on screen it is left 10–210, top 88–100. A point in the middle
 * of it is what a reader clicking the highlight would produce.
 */
/**
 * A selection over real text inside the pages.
 *
 * jsdom gives a Range no rectangles of its own, and rectangles are what the
 * reader turns into a mark, so they are supplied here — one band, ten pixels
 * a character, on the first line of the page.
 */
function selectOnThePage(passage: string) {
	const pages = screen.getByRole('region', { name: 'Paper' });
	const text = document.createTextNode(passage);
	pages.appendChild(text);

	Object.defineProperty(Range.prototype, 'getClientRects', {
		configurable: true,
		writable: true,
		value: function (this: Range) {
			const start = this.startOffset;
			const end = this.endOffset;
			return [
				{ left: start * 10, top: 88, width: (end - start) * 10, height: 12 }
			] as unknown as DOMRectList;
		}
	});

	const range = document.createRange();
	range.setStart(text, 0);
	range.setEnd(text, passage.length);

	const selection = window.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
}

const ON_THE_MARK = { x: 100, y: 94 };
const OFF_THE_MARK = { x: 400, y: 300 };

/** Pick a mark up the way a reader does: left-click it on the page. */
async function pickUp() {
	await screen.findByRole('button', { name: /^Claim:/ });
	await fireEvent.click(screen.getByRole('region', { name: 'Paper' }), {
		clientX: ON_THE_MARK.x,
		clientY: ON_THE_MARK.y
	});
}

/** The menu the right button gives, which is about the mark where it lies. */
async function openMenu() {
	await screen.findByRole('button', { name: /^Claim:/ });
	await fireEvent.contextMenu(screen.getByRole('region', { name: 'Paper' }), {
		clientX: ON_THE_MARK.x,
		clientY: ON_THE_MARK.y
	});
}

/**
 * The menu the popup's own `⋯` gives, which offers the corrections as well.
 *
 * Zotero draws the same distinction, and for the same reason: the fields those
 * items correct are on screen in the popup and are not on the page.
 */
async function openPopupMenu(user: ReturnType<typeof userEvent.setup>) {
	await pickUp();
	await user.click(await screen.findByRole('button', { name: 'More things to do with this mark' }));
}

/** Two bytes of nothing: the reader only decodes it and hands it on. */
const PDF_BASE64 = 'AAEC';

const LABELS = [
	{ id: 'claim', name: 'Claim', colour: '45 95% 62%', position: 0, enabled: true },
	{ id: 'method', name: 'Method', colour: '210 80% 65%', position: 1, enabled: true }
];

const FRAME = {
	page: 1,
	bounds: { left: 0, top: 0, width: 595, height: 800 },
	viewport: { transform: [1, 0, 0, -1, 0, 800] }
};

const MARK = {
	id: 'a1',
	sha256: 'sha-1',
	kind: 'highlight' as const,
	label_id: 'claim',
	page: 1,
	rects: JSON.stringify([{ x: 10, y: 700, w: 200, h: 12 }]),
	quote: 'the effect was strongest',
	prefix: null,
	suffix: null,
	char_start: null,
	char_end: null,
	note: null,
	style: 'fill' as const,
	page_label: null,
	origin: 'erti' as const,
	created_at: '2026-01-01',
	updated_at: '2026-01-01'
};

beforeEach(() => {
	vi.clearAllMocks();
	readerStore.reset();
	invoke.mockResolvedValue(PDF_BASE64);
	viewer.load.mockResolvedValue(undefined);
	viewer.frameFor.mockReturnValue(FRAME);
	db.sourceForPath.mockResolvedValue('sha-1');
	db.annotationsForSource.mockResolvedValue([]);
	db.annotationLabels.mockResolvedValue(LABELS);
	annotationsStore.reset();
});

describe('opening a paper', () => {
	it('asks the backend for the file it was given', async () => {
		render(Harness, { path: '/papers/one.pdf' });

		await waitFor(() =>
			expect(invoke).toHaveBeenCalledWith('read_pdf_file', { path: '/papers/one.pdf' })
		);
	});

	it('hands the decoded bytes to the viewer', async () => {
		render(Harness, { path: '/papers/one.pdf' });

		await waitFor(() => expect(viewer.load).toHaveBeenCalled());
		expect(viewer.load.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
	});

	it('says it is loading until the bytes arrive', async () => {
		let release: (value: string) => void = () => {};
		invoke.mockReturnValue(new Promise<string>((resolve) => (release = resolve)));

		render(Harness, { path: '/papers/one.pdf' });

		expect(screen.getByText('Loading PDF…')).toBeInTheDocument();

		release(PDF_BASE64);
		await waitFor(() => expect(screen.queryByText('Loading PDF…')).not.toBeInTheDocument());
	});

	it('shows what went wrong rather than an empty viewer', async () => {
		// The failure this replaced surfaced as an unhandled rejection while the
		// pane sat on a viewer with nothing in it.
		invoke.mockRejectedValue(new Error('file is not a PDF'));

		render(Harness, { path: '/papers/broken.pdf' });

		expect(await screen.findByText('file is not a PDF')).toBeInTheDocument();
	});
});

describe('what the rest of the app can see', () => {
	it('registers itself for its pane and its path', async () => {
		render(Harness, { path: '/papers/one.pdf', paneId: 'pane-2' });

		await waitFor(() => expect(get(readerStore)['pane-2']).toBeDefined());
		expect(get(readerStore)['pane-2'].path).toBe('/papers/one.pdf');
	});

	it('publishes the page count and the page as the viewer reports them', async () => {
		render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(get(readerStore)['pane-1']).toBeDefined());

		captured.current.onPagesLoaded?.(22);
		captured.current.onPage?.(7);

		await waitFor(() => expect(get(readerStore)['pane-1'].pages).toBe(22));
		expect(get(readerStore)['pane-1'].page).toBe(7);
	});

	it('can be jumped into from elsewhere, which is what a citation needs', async () => {
		render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(get(readerStore)['pane-1']).toBeDefined());

		const jumped = readerStore.navigate('/papers/one.pdf', { page: 4 });

		expect(jumped).toBe(true);
		expect(viewer.goTo).toHaveBeenCalledWith({ page: 4 });
	});

	it('lets go of the viewer and the registration when it is destroyed', async () => {
		const { unmount } = render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(get(readerStore)['pane-1']).toBeDefined());

		unmount();

		expect(viewer.destroy).toHaveBeenCalled();
		expect(get(readerStore)).toEqual({});
	});
});

describe('remembering the place', () => {
	it('returns to the page it was left on', async () => {
		// Workspace keys the reader on the path, so switching between two open
		// papers destroys and rebuilds it. Without this, glancing at a second
		// paper costs the place in the first.
		const first = render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(get(readerStore)['pane-1']).toBeDefined());

		captured.current.onPage?.(12);
		first.unmount();

		render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(viewer.load).toHaveBeenCalledTimes(2));

		captured.current.onPagesLoaded?.(40);

		expect(viewer.goToPage).toHaveBeenCalledWith(12);
	});

	it('does not scroll a paper opened for the first time', async () => {
		render(Harness, { path: '/papers/fresh.pdf' });
		await waitFor(() => expect(viewer.load).toHaveBeenCalled());

		captured.current.onPagesLoaded?.(40);

		expect(viewer.goToPage).not.toHaveBeenCalled();
	});
});

describe('the toolbar', () => {
	it('turns the page', async () => {
		const user = userEvent.setup();
		render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(viewer.load).toHaveBeenCalled());

		captured.current.onPagesLoaded?.(22);
		captured.current.onPage?.(3);
		await waitFor(() => expect(screen.getByLabelText('Page number')).toHaveValue('3'));

		await user.click(screen.getByRole('button', { name: 'Next page' }));

		expect(viewer.goToPage).toHaveBeenCalledWith(4);
	});

	it('will not step off the front of the paper', async () => {
		render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(viewer.load).toHaveBeenCalled());

		captured.current.onPagesLoaded?.(22);

		await waitFor(() =>
			expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
		);
	});

	it('searches the paper', async () => {
		const user = userEvent.setup();
		render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(viewer.load).toHaveBeenCalled());

		await user.click(screen.getByRole('button', { name: 'Find in this paper' }));
		await user.type(await screen.findByLabelText('Find in this paper'), 'entropy');

		expect(viewer.find).toHaveBeenCalledWith('entropy', undefined);
	});

	it('zooms', async () => {
		const user = userEvent.setup();
		render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(viewer.load).toHaveBeenCalled());

		await user.click(screen.getByRole('button', { name: 'Zoom in' }));

		expect(viewer.zoomBy).toHaveBeenCalledWith(1.1);
	});
});

describe('the marks on a paper', () => {
	it('offers every label, not just a fallback colour', async () => {
		// The labels were fetched only for a paper the library had never seen, so
		// every real paper opened with an empty menu and highlighting fell back to
		// a hardcoded yellow.
		render(Harness, { path: '/papers/one.pdf' });

		await waitFor(() => expect(get(annotationsStore).labels).toHaveLength(2));
	});

	it('draws the marks already on the paper', async () => {
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });

		expect(await screen.findByRole('button', { name: /^Claim:/ })).toBeInTheDocument();
	});

	it('writes a note when a mark is clicked', async () => {
		// The left button is for the reason the mark exists: saying what you make
		// of the passage. Everything else is a correction, and corrections are on
		// the right button.
		//
		// Clicked on the *page*, because that is where the click lands. The marks
		// take no pointer events — an element drawn over the words is an element
		// in the way of selecting them — so the reader answers this from the
		// rectangles it stores rather than from the DOM.
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		await screen.findByRole('button', { name: /^Claim:/ });

		await fireEvent.click(screen.getByRole('region', { name: 'Paper' }), {
			clientX: ON_THE_MARK.x,
			clientY: ON_THE_MARK.y
		});

		expect(await screen.findByRole('group', { name: 'Note on this passage' })).toBeInTheDocument();
	});

	it('leaves a click on bare paper alone', async () => {
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		await screen.findByRole('button', { name: /^Claim:/ });

		await fireEvent.click(screen.getByRole('region', { name: 'Paper' }), {
			clientX: OFF_THE_MARK.x,
			clientY: OFF_THE_MARK.y
		});

		expect(screen.queryByRole('group', { name: 'Note on this passage' })).not.toBeInTheDocument();
	});

	it('does not read the end of a selection drag as pointing at a mark', async () => {
		// Sweeping a selection across a highlight ends in a click on the page, and
		// that click is not the reader pointing at anything. Opening a note over
		// the passage they have just selected is exactly the interruption this is
		// for avoiding.
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		await screen.findByRole('button', { name: /^Claim:/ });

		const pages = screen.getByRole('region', { name: 'Paper' });
		pressOn(pages, { x: 20, y: 94 });
		pointerOn(pages, 'pointermove', { x: 180, y: 94 });
		await fireEvent.click(pages, { clientX: 180, clientY: 94 });

		expect(screen.queryByRole('group', { name: 'Note on this passage' })).not.toBeInTheDocument();
	});

	it('still reaches a mark from the keyboard', async () => {
		// The marks are unreachable by pointer on purpose, so they have to stay
		// reachable some other way. Enter dispatches a click to whatever is
		// focused, whether or not it can be pointed at.
		const user = userEvent.setup();
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		(await screen.findByRole('button', { name: /^Claim:/ })).focus();
		await user.keyboard('{Enter}');

		expect(await screen.findByRole('group', { name: 'Note on this passage' })).toBeInTheDocument();
	});

	it('saves what was written on the way out', async () => {
		const user = userEvent.setup();
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		await screen.findByRole('button', { name: /^Claim:/ });
		await fireEvent.click(screen.getByRole('region', { name: 'Paper' }), {
			clientX: ON_THE_MARK.x,
			clientY: ON_THE_MARK.y
		});
		// By placeholder: the page-number box in the toolbar is a textbox too.
		const comment = await screen.findByPlaceholderText('Add comment');
		await user.type(comment, 'contradicts Jones');
		// Saved on the way out rather than per keystroke: each save writes to the
		// database and re-embeds, and a note is not written one letter at a time.
		await fireEvent.blur(comment);

		await waitFor(() =>
			expect(db.saveAnnotation).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'a1', note: 'contradicts Jones' })
			)
		);
	});

	it('opens the menu on the right button', async () => {
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		await screen.findByRole('button', { name: /^Claim:/ });
		await fireEvent.contextMenu(screen.getByRole('region', { name: 'Paper' }), {
			clientX: ON_THE_MARK.x,
			clientY: ON_THE_MARK.y
		});

		expect(
			await screen.findByRole('group', { name: 'What to do with this highlight' })
		).toBeInTheDocument();
	});

	it('offers the other colours in that menu', async () => {
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		await screen.findByRole('button', { name: /^Claim:/ });
		await fireEvent.contextMenu(screen.getByRole('region', { name: 'Paper' }), {
			clientX: ON_THE_MARK.x,
			clientY: ON_THE_MARK.y
		});

		expect(await screen.findByRole('button', { name: 'Method' })).toBeInTheDocument();
	});

	it('refiles a mark under the colour that was chosen', async () => {
		const user = userEvent.setup();
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		await screen.findByRole('button', { name: /^Claim:/ });
		await fireEvent.contextMenu(screen.getByRole('region', { name: 'Paper' }), {
			clientX: ON_THE_MARK.x,
			clientY: ON_THE_MARK.y
		});
		await user.click(await screen.findByRole('button', { name: 'Method' }));

		await waitFor(() =>
			expect(db.saveAnnotation).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'a1', label_id: 'method' })
			)
		);
	});

	it('deletes a mark from its own menu', async () => {
		const user = userEvent.setup();
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		await user.pointer({
			keys: '[MouseRight]',
			target: await screen.findByRole('button', { name: /^Claim:/ })
		});
		await user.click(await screen.findByRole('button', { name: 'Delete' }));

		await waitFor(() => expect(db.deleteAnnotation).toHaveBeenCalledWith('a1'));
	});
});

describe('choosing how to mark', () => {
	it('offers both a highlight and an underline', async () => {
		render(Harness, { path: '/papers/one.pdf' });

		expect(
			await screen.findByRole('button', { name: 'Highlight as you select' })
		).toBeInTheDocument();
		expect(
			await screen.findByRole('button', { name: 'Underline as you select' })
		).toBeInTheDocument();
	});

	it('shows which one is in force', async () => {
		const user = userEvent.setup();
		render(Harness, { path: '/papers/one.pdf' });

		const underline = await screen.findByRole('button', { name: 'Underline as you select' });
		expect(underline).toHaveAttribute('aria-pressed', 'false');

		await user.click(underline);

		// Its name changes with its state, because pressing it again turns it off.
		expect(await screen.findByRole('button', { name: 'Stop underlining' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect(screen.getByRole('button', { name: 'Highlight as you select' })).toHaveAttribute(
			'aria-pressed',
			'false'
		);
	});

	it('names the colour in force, rather than only showing it', async () => {
		// Eight squares say nothing about which one is Limitation.
		render(Harness, { path: '/papers/one.pdf' });

		expect(
			await screen.findByRole('button', { name: 'Highlight colour: Claim' })
		).toBeInTheDocument();
	});

	it('lists the labels by name when opened', async () => {
		// Queried by text rather than by role: floating-ui cannot measure in jsdom,
		// so it leaves the menu's wrapper `visibility: hidden` and the accessibility
		// tree does not see it. In a browser it is positioned and visible.
		const user = userEvent.setup();
		render(Harness, { path: '/papers/one.pdf' });

		await user.click(await screen.findByRole('button', { name: 'Highlight colour: Claim' }));

		expect(await screen.findByText('Claim')).toBeInTheDocument();
		expect(await screen.findByText('Method')).toBeInTheDocument();
	});

	it('lets a label be renamed where it is read', async () => {
		const user = userEvent.setup();
		render(Harness, { path: '/papers/one.pdf' });

		await user.click(await screen.findByRole('button', { name: 'Highlight colour: Claim' }));
		// By title: the accessible-name query cannot see inside the hidden wrapper
		// that floating-ui leaves behind in jsdom.
		await user.click((await screen.findAllByTitle('Rename'))[0]);

		expect(await screen.findByLabelText('Name for this label')).toHaveValue('Claim');
	});

	it("gives the labels their colours' names back, where they are read", async () => {
		// Erti has an opinion about what a highlight means and it is only a
		// suggestion. Zotero's colours are simply called Yellow and Red, and a
		// researcher who already knows what their own yellow means should not
		// have to go to Settings to say so.
		const user = userEvent.setup();
		render(Harness, { path: '/papers/one.pdf' });

		await user.click(await screen.findByRole('button', { name: 'Highlight colour: Claim' }));
		await user.click(await screen.findByText('Name them after their colours'));

		await waitFor(() => expect(db.nameLabelsAfterColours).toHaveBeenCalled());
	});

	it('remembers the colour chosen from the toolbar', async () => {
		const user = userEvent.setup();
		render(Harness, { path: '/papers/one.pdf' });

		await user.click(await screen.findByRole('button', { name: 'Highlight colour: Claim' }));
		await user.click(await screen.findByText('Method'));

		await waitFor(() => expect(get(annotationsStore).lastLabel).toBe('method'));
	});
});

describe('the tools Zotero puts in the toolbar', () => {
	it('offers all four, and holds only one at a time', async () => {
		// One tool in hand, as in Zotero. Highlighting and dragging a box over a
		// figure are different acts, and holding both would mean guessing which
		// was meant on every drag.
		const user = userEvent.setup();
		render(Harness, { path: '/papers/one.pdf' });

		const highlight = await screen.findByRole('button', { name: 'Highlight as you select' });
		expect(screen.getByRole('button', { name: 'Underline as you select' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Leave a note on the page' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Keep a figure or table' })).toBeInTheDocument();

		await user.click(highlight);
		expect(await screen.findByRole('button', { name: 'Stop highlighting' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);

		await user.click(screen.getByRole('button', { name: 'Keep a figure or table' }));

		expect(await screen.findByRole('button', { name: 'Stop keeping figures' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect(screen.getByRole('button', { name: 'Highlight as you select' })).toHaveAttribute(
			'aria-pressed',
			'false'
		);
	});

	it('leaves a note where the page was clicked', async () => {
		const user = userEvent.setup();
		render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(viewer.load).toHaveBeenCalled());
		captured.current.onPagesLoaded?.(20);

		await user.click(await screen.findByRole('button', { name: 'Leave a note on the page' }));
		pressOn(screen.getByRole('region', { name: 'Paper' }), { x: 120, y: 300 });

		await waitFor(() => expect(db.saveAnnotation).toHaveBeenCalled());

		const saved = db.saveAnnotation.mock.calls.at(-1)![0];
		expect(saved.kind).toBe('page-note');
		// Anchored to the spot, not merely to the page: that is what makes it a
		// note *on* the figure rather than a note about the sheet.
		expect(JSON.parse(saved.rects)).toHaveLength(1);
	});

	it('puts the tool down once the note is placed', async () => {
		const user = userEvent.setup();
		render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(viewer.load).toHaveBeenCalled());
		captured.current.onPagesLoaded?.(20);

		await user.click(await screen.findByRole('button', { name: 'Leave a note on the page' }));
		pressOn(screen.getByRole('region', { name: 'Paper' }), { x: 120, y: 300 });

		expect(await screen.findByRole('button', { name: 'Leave a note on the page' })).toHaveAttribute(
			'aria-pressed',
			'false'
		);
	});
});

describe('sweeping out a selection', () => {
	it('hears a release that happened outside the pane', async () => {
		// A selection dragged upwards very often ends with the pointer released
		// over the toolbar or outside the window. Heard only on the pages, that
		// release never arrives and the passage is never offered.
		viewer.pageText.mockResolvedValue('the effect was strongest in the second cohort');

		render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(viewer.load).toHaveBeenCalled());
		captured.current.onPagesLoaded?.(20);
		await screen.findByRole('button', { name: 'Highlight as you select' });

		selectOnThePage('the effect was strongest');
		await fireEvent.mouseUp(document.body);

		expect(
			await screen.findByRole('group', { name: 'What to do with the selected passage' })
		).toBeInTheDocument();
	});
});

describe('what the reader sees after marking', () => {
	it('shows a new mark in the panel without it being reopened', async () => {
		const user = userEvent.setup();
		viewer.pageText.mockResolvedValue('the effect was strongest in the second cohort');
		db.annotationsForSource.mockResolvedValue([]);

		render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(viewer.load).toHaveBeenCalled());
		captured.current.onPagesLoaded?.(20);

		// The marks live in the reader's panel now, one tab of three, reached from
		// the right of the toolbar rather than from the panel button.
		await user.click(await screen.findByRole('button', { name: '0 marks on this paper' }));
		await user.click(screen.getByRole('button', { name: 'Highlight as you select' }));

		// The paper now has one mark on it, as the library would report after a save.
		db.annotationsForSource.mockResolvedValue([MARK]);
		selectOnThePage('the effect was strongest');
		await fireEvent.mouseUp(document.body);

		expect(await screen.findByText('the effect was strongest')).toBeInTheDocument();
	});

	it('opens one menu on a right click, not two', async () => {
		// A right click leaves the selection where it was, and its release was
		// being read as a fresh selection — so the passage popup came up behind
		// the mark's own menu.
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(viewer.load).toHaveBeenCalled());
		captured.current.onPagesLoaded?.(20);
		await screen.findByRole('button', { name: /^Claim:/ });

		selectOnThePage('the effect was strongest');

		const pages = screen.getByRole('region', { name: 'Paper' });
		await fireEvent.contextMenu(pages, { clientX: ON_THE_MARK.x, clientY: ON_THE_MARK.y });
		await fireEvent.mouseUp(pages, { button: 2 });

		expect(
			await screen.findByRole('group', { name: 'What to do with this highlight' })
		).toBeInTheDocument();
		expect(
			screen.queryByRole('group', { name: 'What to do with the selected passage' })
		).not.toBeInTheDocument();
	});
});

describe('taking it back', () => {
	async function withOneMark() {
		db.annotationsForSource.mockResolvedValue([MARK]);
		render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(viewer.load).toHaveBeenCalled());
		captured.current.onPagesLoaded?.(20);
		await screen.findByRole('button', { name: /^Claim:/ });
	}

	const undo = () =>
		fireEvent.keyDown(screen.getByRole('region', { name: 'Paper' }), { key: 'z', ctrlKey: true });

	it('puts back a mark that was deleted', async () => {
		const user = userEvent.setup();
		await withOneMark();

		await openMenu();
		await user.click(await screen.findByRole('button', { name: 'Delete' }));
		await waitFor(() => expect(db.deleteAnnotation).toHaveBeenCalledWith('a1'));

		db.saveAnnotation.mockClear();
		await undo();

		// Written back as it was, rather than as a new mark with a new id — which
		// is what keeps "the first thing I noticed in this paper" meaningful.
		await waitFor(() =>
			expect(db.saveAnnotation).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'a1', quote: MARK.quote, label_id: 'claim' })
			)
		);
	});

	it('takes back a colour, restoring the one before it', async () => {
		const user = userEvent.setup();
		await withOneMark();

		await openMenu();
		await user.click(await screen.findByRole('button', { name: 'Method' }));
		await waitFor(() =>
			expect(db.saveAnnotation).toHaveBeenCalledWith(
				expect.objectContaining({ label_id: 'method' })
			)
		);

		db.saveAnnotation.mockClear();
		await undo();

		await waitFor(() =>
			expect(db.saveAnnotation).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'a1', label_id: 'claim' })
			)
		);
	});

	it('removes a mark that was just made, rather than editing it', async () => {
		const user = userEvent.setup();
		viewer.pageText.mockResolvedValue('the effect was strongest in the second cohort');
		db.annotationsForSource.mockResolvedValue([]);

		render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(viewer.load).toHaveBeenCalled());
		captured.current.onPagesLoaded?.(20);
		await user.click(await screen.findByRole('button', { name: 'Highlight as you select' }));

		selectOnThePage('the effect was strongest');
		await fireEvent.mouseUp(document.body);
		await waitFor(() => expect(db.saveAnnotation).toHaveBeenCalled());

		await undo();

		await waitFor(() => expect(db.deleteAnnotation).toHaveBeenCalled());
	});

	it('says nothing and changes nothing when there is nothing to take back', async () => {
		await withOneMark();

		db.saveAnnotation.mockClear();
		db.deleteAnnotation.mockClear();
		await undo();

		expect(db.saveAnnotation).not.toHaveBeenCalled();
		expect(db.deleteAnnotation).not.toHaveBeenCalled();
	});

	it('does not arm a redo, so pressing it twice does not restore the change', async () => {
		const user = userEvent.setup();
		await withOneMark();

		await openMenu();
		await user.click(await screen.findByRole('button', { name: 'Delete' }));
		await waitFor(() => expect(db.deleteAnnotation).toHaveBeenCalled());

		await undo();
		await waitFor(() => expect(db.saveAnnotation).toHaveBeenCalled());

		db.deleteAnnotation.mockClear();
		await undo();

		expect(db.deleteAnnotation).not.toHaveBeenCalled();
	});
});

describe('finding the way back', () => {
	it('has nowhere to go until something jumps', async () => {
		render(Harness, { path: '/papers/one.pdf' });

		expect(
			await screen.findByRole('button', { name: 'Back to where you jumped from' })
		).toBeDisabled();
	});

	it('returns to where a citation was followed from', async () => {
		// Following a citation into page 41 and then having to find the way back
		// to page 3 by hand is what stops people following citations at all.
		const user = userEvent.setup();
		render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(get(readerStore)['pane-1']).toBeDefined());

		readerStore.navigate('/papers/one.pdf', { page: 41 });

		const back = await screen.findByRole('button', { name: 'Back to where you jumped from' });
		await waitFor(() => expect(back).not.toBeDisabled());

		await user.click(back);

		expect(viewer.goToPlace).toHaveBeenCalledWith({ page: 1, top: 0, left: 0, scale: 1 });
	});
});

describe('the page numbers the paper prints', () => {
	beforeEach(() => {
		// A journal article beginning on page 843: eleven sheets in, the paper
		// calls itself 853, and 853 is what a citation has to say.
		viewer.pageLabels.mockResolvedValue(
			Array.from({ length: 20 }, (_, index) => String(843 + index))
		);
	});

	it('shows the printed number, with the sheet beside it', async () => {
		render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(viewer.load).toHaveBeenCalled());
		captured.current.onPagesLoaded?.(20);

		await waitFor(() =>
			expect(screen.getByLabelText('Page number the paper prints')).toHaveValue('843')
		);
		expect(screen.getByText(/\(1\)\s*of 20/)).toBeInTheDocument();
	});

	it('goes to a printed number when one is typed', async () => {
		const user = userEvent.setup();
		render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(viewer.load).toHaveBeenCalled());
		captured.current.onPagesLoaded?.(20);

		const box = await screen.findByLabelText('Page number the paper prints');
		await user.clear(box);
		await user.type(box, '853');
		await user.tab();

		expect(viewer.goToPage).toHaveBeenCalledWith(11);
	});

	it('gives a new mark the number the paper prints, without being asked', async () => {
		// The whole reason to read the labels out of the file: nobody should have
		// to notice that this paper starts at 843 for their citation to be right.
		const user = userEvent.setup();
		render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(viewer.load).toHaveBeenCalled());
		captured.current.onPagesLoaded?.(20);

		await waitFor(() =>
			expect(screen.getByLabelText('Page number the paper prints')).toHaveValue('843')
		);

		await user.click(await screen.findByRole('button', { name: 'Leave a note on the page' }));
		pressOn(screen.getByRole('region', { name: 'Paper' }), { x: 120, y: 300 });

		await waitFor(() => expect(db.saveAnnotation).toHaveBeenCalled());
		expect(db.saveAnnotation.mock.calls.at(-1)![0].page_label).toBe('843');
	});

	it('says only the sheet when the file records nothing', async () => {
		viewer.pageLabels.mockResolvedValue(null);

		render(Harness, { path: '/papers/one.pdf' });
		await waitFor(() => expect(viewer.load).toHaveBeenCalled());
		captured.current.onPagesLoaded?.(20);

		expect(await screen.findByLabelText('Page number')).toHaveValue('1');
		expect(screen.queryByText(/\(1\)/)).not.toBeInTheDocument();
	});
});

describe('how the pages are laid out', () => {
	async function openAppearance(user: ReturnType<typeof userEvent.setup>) {
		await user.click(await screen.findByRole('button', { name: 'How the pages are laid out' }));
	}

	it('reads the paper across rather than down', async () => {
		const user = userEvent.setup();
		render(Harness, { path: '/papers/one.pdf' });
		await openAppearance(user);

		// By title: floating-ui cannot measure in jsdom, so it leaves the popup's
		// wrapper hidden and the accessibility tree does not see inside it.
		await user.click(await screen.findByTitle('Horizontal'));

		expect(viewer.setScrollMode).toHaveBeenCalledWith('horizontal');
	});

	it('opens it as facing pages', async () => {
		const user = userEvent.setup();
		render(Harness, { path: '/papers/one.pdf' });
		await openAppearance(user);

		await user.click(await screen.findByTitle('Facing, odd on the left'));

		expect(viewer.setSpreadMode).toHaveBeenCalledWith('odd');
	});

	it('turns a paper that was scanned sideways', async () => {
		const user = userEvent.setup();
		render(Harness, { path: '/papers/one.pdf' });
		await openAppearance(user);

		await user.click(await screen.findByTitle('Turn the pages right'));

		expect(viewer.rotateBy).toHaveBeenCalledWith(90);
	});

	it('dims the paper for reading at night', async () => {
		const user = userEvent.setup();
		render(Harness, { path: '/papers/one.pdf' });
		await openAppearance(user);

		await user.click(await screen.findByTitle('A dark page, for reading in a dark room'));

		await waitFor(() =>
			expect(screen.getByRole('region', { name: 'Paper' })).toHaveAttribute(
				'data-page-theme',
				'dark'
			)
		);
	});
});

describe('re-drawing what a mark covers', () => {
	/**
	 * Stand in for the browser's hit testing, which jsdom has none of.
	 *
	 * `caretRangeFromPoint` is what turns a pointer into a place in the text, and
	 * it is the whole mechanism the drag runs on. Here it answers from a real
	 * text node so the ranges the reader builds are real ranges, and the
	 * rectangles come from the offsets — enough to prove the passage the drag
	 * ends up with, which is the thing that was wrong.
	 */
	function stubCaret(passage: string) {
		// Inside the pages, because the reader refuses a drag whose caret lands
		// outside them — a drag into the toolbar or the marks panel must not
		// re-anchor the passage. On `document.body` the stub was outside the
		// paper, so every drag in these tests was correctly ignored.
		const text = document.createTextNode(passage);
		screen.getByRole('region', { name: 'Paper' }).appendChild(text);

		// x is read as a character offset, so a test can say where it dragged to.
		const at = (x: number) => {
			const range = document.createRange();
			const offset = Math.max(0, Math.min(passage.length, Math.round(x)));
			range.setStart(text, offset);
			range.collapse(true);
			return range;
		};

		(
			document as Document & { caretRangeFromPoint: (x: number, y: number) => Range }
		).caretRangeFromPoint = at;

		// One rectangle for the range, ten pixels a character, on the first line.
		// Defined rather than spied on: jsdom's Range has no `getClientRects` at
		// all, so there is nothing to replace.
		Object.defineProperty(Range.prototype, 'getClientRects', {
			configurable: true,
			writable: true,
			value: function (this: Range) {
				const start = this.startOffset;
				const end = this.endOffset;
				return [
					{ left: start * 10, top: 88, width: (end - start) * 10, height: 12 }
				] as unknown as DOMRectList;
			}
		});

		return { text, at };
	}

	it('makes the ends draggable as soon as the mark is picked up', async () => {
		// No mode, no banner, no menu item. Zotero draws a selected annotation
		// with an outline and a caret at each end, and those carets are simply
		// live — which is why neither reader needs a way out of a state it never
		// entered. Ours needed Escape, and that was the whole complaint.
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		await pickUp();
		stubCaret('the effect was strongest in the second cohort');

		expect(
			await screen.findByRole('button', { name: 'Drag to move where this mark starts' })
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Drag to move where this mark ends' })
		).toBeInTheDocument();
	});

	it('says which mark is in hand', async () => {
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		await pickUp();

		expect(document.querySelector('.erti-mark')).toHaveClass('erti-mark-picked');
	});

	it('puts the mark down on a click elsewhere, without Escape', async () => {
		// The reported fault: re-drawing a mark could only be left with Escape,
		// because it was a mode rather than something held.
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		await pickUp();
		stubCaret('the effect was strongest in the second cohort');
		await screen.findByRole('button', { name: 'Drag to move where this mark ends' });

		await fireEvent.click(screen.getByRole('region', { name: 'Paper' }), {
			clientX: OFF_THE_MARK.x,
			clientY: OFF_THE_MARK.y
		});

		expect(
			screen.queryByRole('button', { name: 'Drag to move where this mark ends' })
		).not.toBeInTheDocument();
		expect(screen.queryByRole('group', { name: 'Note on this passage' })).not.toBeInTheDocument();
	});

	it('takes the handles out of the hit test while one is being dragged', async () => {
		// The drag asks the document which character is under the pointer, and the
		// handles follow the pointer. Left in the hit test they are the answer it
		// gets, so the passage is unreachable and nothing moves. The mark itself
		// never takes a pointer at all, which is the other half of the same fault.
		//
		// jsdom cannot hit-test, so what is asserted is the arrangement that makes
		// the hit test come out right rather than the hit test itself.
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		await pickUp();
		stubCaret('the effect was strongest in the second cohort');

		const handle = await screen.findByRole('button', {
			name: 'Drag to move where this mark ends'
		});
		expect(handle).not.toHaveClass('erti-handle-dragging');

		pressOn(screen.getByRole('region', { name: 'Paper' }), END_OF_THE_MARK);
		await tick();

		expect(screen.getByRole('button', { name: 'Drag to move where this mark ends' })).toHaveClass(
			'erti-handle-dragging'
		);
	});

	it('moves the mark with the handle rather than leaving it behind', async () => {
		// The other half of what "works badly" looked like: the carets moved and
		// the band of colour stayed where the passage used to be, so the gesture
		// gave no sign of having done anything until it was over.
		db.annotationsForSource.mockResolvedValue([MARK]);
		viewer.pageText.mockResolvedValue('the effect was strongest in the second cohort');

		render(Harness, { path: '/papers/one.pdf' });
		await pickUp();
		stubCaret('the effect was strongest in the second cohort');

		const before = (document.querySelector('.erti-mark') as HTMLElement).style.width;

		await screen.findByRole('button', { name: 'Drag to move where this mark ends' });
		pressOn(screen.getByRole('region', { name: 'Paper' }), END_OF_THE_MARK);
		pointerOn(window as unknown as Element, 'pointermove', { x: 44, y: 94 });

		await waitFor(() =>
			expect((document.querySelector('.erti-mark') as HTMLElement).style.width).not.toBe(before)
		);
	});

	it('keeps what the drag ended up covering', async () => {
		db.annotationsForSource.mockResolvedValue([MARK]);
		viewer.pageText.mockResolvedValue('the effect was strongest in the second cohort');

		render(Harness, { path: '/papers/one.pdf' });
		await pickUp();
		stubCaret('the effect was strongest in the second cohort');

		await screen.findByRole('button', { name: 'Drag to move where this mark ends' });
		pressOn(screen.getByRole('region', { name: 'Paper' }), END_OF_THE_MARK);
		pointerOn(window as unknown as Element, 'pointermove', { x: 44, y: 94 });
		await fireEvent.pointerUp(window);

		await waitFor(() => expect(db.saveAnnotation).toHaveBeenCalled());

		const saved = db.saveAnnotation.mock.calls.at(-1)![0];
		expect(saved.id).toBe('a1');
		expect(saved.quote).not.toBe(MARK.quote);
	});

	it('is still drawn, in its own colour, the moment the drag ends', async () => {
		// The reported fault: right after extending or shortening a mark its
		// colour went, and came back only on a click somewhere else.
		db.annotationsForSource.mockResolvedValue([MARK]);
		viewer.pageText.mockResolvedValue('the effect was strongest in the second cohort');

		render(Harness, { path: '/papers/one.pdf' });
		await pickUp();
		stubCaret('the effect was strongest in the second cohort');

		const pages = screen.getByRole('region', { name: 'Paper' });
		pressOn(pages, END_OF_THE_MARK);
		pointerOn(window as unknown as Element, 'pointermove', { x: 44, y: 94 });
		await fireEvent.pointerUp(window);
		// The click a release on the pages produces, which is what used to put the
		// mark down again the instant it had been re-drawn.
		await fireEvent.click(pages, { clientX: 44, clientY: 94 });

		await waitFor(() => expect(db.saveAnnotation).toHaveBeenCalled());

		const drawn = document.querySelector('.erti-mark') as HTMLElement | null;
		expect(drawn).not.toBeNull();
		expect(drawn!.style.getPropertyValue('--mark-colour')).toBe('45 95% 62%');
	});

	it('keeps the mark in hand when a drag ends past its new edge', async () => {
		// Shortening a mark leaves the pointer beyond it, so the click that ends
		// the drag lands on bare paper — and a click on bare paper puts the mark
		// down. Finishing a drag is not the same act as clicking away from it.
		db.annotationsForSource.mockResolvedValue([MARK]);
		viewer.pageText.mockResolvedValue('the effect was strongest in the second cohort');

		render(Harness, { path: '/papers/one.pdf' });
		await pickUp();
		stubCaret('the effect was strongest in the second cohort');

		const pages = screen.getByRole('region', { name: 'Paper' });
		pressOn(pages, END_OF_THE_MARK);
		pointerOn(window as unknown as Element, 'pointermove', { x: 44, y: 94 });
		await fireEvent.pointerUp(window);
		await fireEvent.click(pages, { clientX: OFF_THE_MARK.x, clientY: OFF_THE_MARK.y });

		expect(
			screen.getByRole('button', { name: 'Drag to move where this mark ends' })
		).toBeInTheDocument();
	});

	it('leaves a mark alone when a handle is put straight back down', async () => {
		// A press with no drag is how someone finds out what the caret is. It must
		// not rewrite the anchor, because re-anchoring is lossy: the quote is
		// re-derived and the offsets into the page text along with it.
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		await pickUp();
		stubCaret(MARK.quote);

		db.saveAnnotation.mockClear();

		await screen.findByRole('button', { name: 'Drag to move where this mark ends' });
		pressOn(screen.getByRole('region', { name: 'Paper' }), END_OF_THE_MARK);
		await fireEvent.pointerUp(window);

		expect(db.saveAnnotation).not.toHaveBeenCalled();
	});
});

describe('the menu Zotero readers already know', () => {
	it('converts between a highlight and an underline', async () => {
		const user = userEvent.setup();
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		await openMenu();
		await user.click(await screen.findByRole('button', { name: 'Convert to underline' }));

		await waitFor(() =>
			expect(db.saveAnnotation).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'a1', style: 'underline' })
			)
		);
	});

	it('offers to convert back the other way for an underline', async () => {
		db.annotationsForSource.mockResolvedValue([{ ...MARK, style: 'underline' }]);

		render(Harness, { path: '/papers/one.pdf' });
		await openMenu();

		expect(await screen.findByRole('button', { name: 'Convert to highlight' })).toBeInTheDocument();
	});

	it('offers the same items whichever way it was opened', async () => {
		// One menu, two routes to it. Zotero hides the corrections behind the
		// popup; a menu that changes with how it was opened has to be learned
		// twice, and a reader fixing a page number cannot know which route carries
		// it.
		const user = userEvent.setup();
		db.annotationsForSource.mockResolvedValue([MARK]);

		const items = () =>
			[
				...screen
					.getByRole('group', { name: 'What to do with this highlight' })
					.querySelectorAll('button')
			]
				.map((b) => b.textContent?.trim())
				.filter((label) => label && label !== 'Close');

		render(Harness, { path: '/papers/one.pdf' });

		await openMenu();
		const fromThePage = items();

		await user.keyboard('{Escape}');
		await openPopupMenu(user);
		const fromThePopup = items();

		expect(fromThePage).toEqual(fromThePopup);
		// And not by both being empty.
		expect(fromThePage).toContain('Edit page number…');
		expect(fromThePage).toContain('Delete');
	});

	it('carries no icons, only words and the colours', async () => {
		// Eleven glyphs down a column say nothing the words do not, and turn a
		// menu into a texture you read past. The colour chips stay, because there
		// the chip is the information: "Limitation" does not say which colour.
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		await openMenu();

		const menu = await screen.findByRole('group', { name: 'What to do with this highlight' });
		expect(menu.querySelectorAll('svg')).toHaveLength(0);
	});

	it('sets the page number the paper prints', async () => {
		// The citation-relevant one: an article beginning on page 843 calls its
		// eleventh sheet 853, and 853 is what a locator has to say.
		const user = userEvent.setup();
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		await openMenu();
		await user.click(await screen.findByRole('button', { name: 'Edit page number…' }));

		const box = await screen.findByLabelText('Printed page number');
		await user.clear(box);
		await user.type(box, '853');
		await user.click(screen.getByRole('button', { name: 'Save' }));

		await waitFor(() =>
			expect(db.saveAnnotation).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'a1', page_label: '853' })
			)
		);
	});

	it('shows the page the paper prints on the mark itself', async () => {
		// The number a citation has to carry, on the card rather than buried in a
		// menu — and double-clicking it is how Zotero lets you correct it.
		db.annotationsForSource.mockResolvedValue([{ ...MARK, page_label: '853' }]);

		render(Harness, { path: '/papers/one.pdf' });
		await pickUp();

		expect(await screen.findByText('853')).toBeInTheDocument();
	});

	it('does not offer a second way to change the quoted words', async () => {
		// The carets at either end say what a mark covers, and re-drawing it
		// re-derives the words. A text field beside them was a second answer to
		// the same question, and the two could disagree.
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		await openMenu();

		expect(screen.queryByRole('button', { name: 'Edit the quoted text…' })).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Edit page number…' })).toBeInTheDocument();
	});

	it('offers the image actions only for an area snapshot', async () => {
		db.annotationsForSource.mockResolvedValue([MARK]);

		render(Harness, { path: '/papers/one.pdf' });
		await openMenu();

		expect(screen.queryByRole('button', { name: 'Copy image' })).not.toBeInTheDocument();
	});

	it('offers them for one', async () => {
		const user = userEvent.setup();
		db.annotationsForSource.mockResolvedValue([{ ...MARK, kind: 'area', quote: null }]);

		render(Harness, { path: '/papers/one.pdf' });
		await user.pointer({
			keys: '[MouseRight]',
			target: await screen.findByRole('button', { name: /^Claim:/ })
		});

		expect(await screen.findByRole('button', { name: 'Copy image' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Save image as…' })).toBeInTheDocument();
		// And not the text-only ones.
		expect(screen.queryByRole('button', { name: 'Convert to underline' })).not.toBeInTheDocument();
	});
});
