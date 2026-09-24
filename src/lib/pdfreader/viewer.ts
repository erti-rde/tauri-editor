import * as pdfjsLib from 'pdfjs-dist';
// The worker resolves from the same package as the library, so the two cannot
// drift. The viewer this replaced was a hand-copied build one minor version
// ahead of `pdfjs-dist`, which is exactly the failure that convention avoids.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
	EventBus,
	FindState,
	PDFFindController,
	PDFLinkService,
	PDFViewer,
	ScrollMode,
	SpreadMode
} from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';

import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';

import type { Line } from '$lib/ingest/extract';
import type { PdfAnnotationLike } from './importAnnotations';

import { pageLinesFrom, pageTextFrom } from './pageText';

import {
	boundingRect,
	rectToView,
	type PageFrame,
	type PdfLocation,
	type Rect,
	type ViewportLike
} from './location';

/**
 * The PDF viewer, assembled from pdf.js's own components.
 *
 * The reader used to be an iframe around pdf.js's stock viewer application.
 * That worked, and gave nothing back: no selection, no coordinates, no page
 * events crossed the frame boundary, so a paper could be read and nothing about
 * the reading could be kept.
 *
 * This composes the same library's pieces directly instead. `PDFViewer` still
 * supplies virtualised rendering, zoom, scroll modes and the text layer, and
 * `PDFFindController` still supplies search — the work is theirs, not ours. What
 * changes is that the chrome, the selection and eventually the highlights are
 * on our side of the boundary, and can use the application's own theme rather
 * than pdf.js's.
 *
 * Every pdf.js import in the reader lives in this file, so the rest of the
 * feature is testable without mounting a viewer.
 */

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * Where pdf.js fetches character maps and font data at run time.
 *
 * Neither is bundled into the library. Without the standard fonts a paper that
 * names Helvetica without embedding it draws in a substitute with the wrong
 * metrics; without the character maps a CJK paper draws nothing. Both are
 * copied into `static/` by `scripts/sync-pdf-assets.mjs`.
 */
const CMAP_URL = '/pdf-assets/cmaps/';
const STANDARD_FONT_URL = '/pdf-assets/standard_fonts/';

/** Room left above a passage when jumping to it, in PDF units. */
const JUMP_MARGIN = 24;

export interface FindSummary {
	matches: number;
	/** 1-based index of the current match, or 0 when there are none. */
	current: number;
}

/**
 * How the pages are laid out, in pdf.js's own numbering.
 *
 * Named rather than passed through as integers because 0, 1 and 2 mean
 * different things in the two settings, and a reader looking at
 * `setSpreadMode(1)` cannot tell odd from horizontal.
 */
export const SCROLL_MODES = {
	vertical: ScrollMode.VERTICAL,
	horizontal: ScrollMode.HORIZONTAL,
	wrapped: ScrollMode.WRAPPED
} as const;
export const SPREAD_MODES = {
	none: SpreadMode.NONE,
	odd: SpreadMode.ODD,
	even: SpreadMode.EVEN
} as const;

export type ScrollModeName = keyof typeof SCROLL_MODES;
export type SpreadModeName = keyof typeof SPREAD_MODES;

/**
 * Somewhere the reader has been, so it can be gone back to.
 *
 * The scroll offsets are only meaningful at the zoom they were taken at — a
 * pixel is a different amount of paper at 80% than at 300% — so the scale
 * travels with them and the page number is the fallback when it has changed.
 */
/**
 * An entry in the paper's own table of contents.
 *
 * Papers carry one surprisingly often — anything typeset from LaTeX or exported
 * from Word usually does — and it is the fastest way into a long document.
 * `dest` is the PDF's own destination, opaque here and handed back to pdf.js to
 * resolve, because resolving it means reading the name tree.
 */
export interface OutlineItem {
	title: string;
	dest: unknown;
	children: OutlineItem[];
}

export interface ReaderPlace {
	page: number;
	top: number;
	left: number;
	scale: number;
}

export interface ViewerCallbacks {
	onPage?: (page: number) => void;
	onPagesLoaded?: (pages: number) => void;
	onScale?: (scale: number) => void;
	onFind?: (summary: FindSummary) => void;
	/**
	 * The pages have moved or resized.
	 *
	 * Anything drawn over them measured against where they were, so this is the
	 * cue to measure again. Scrolling is deliberately not one of these: the
	 * highlight layer works in the scrolling content's own coordinates, which do
	 * not change when it scrolls — only zooming and re-rendering move a page.
	 */
	onLayout?: () => void;
}

export type ZoomValue = number | 'auto' | 'page-width' | 'page-fit' | 'page-actual';

export interface ReaderViewer {
	/**
	 * Hand over the bytes.
	 *
	 * pdf.js transfers the buffer to its worker, so the caller must not read
	 * `data` again afterwards.
	 */
	load(data: Uint8Array): Promise<void>;
	goToPage(page: number): void;
	goTo(location: PdfLocation): void;
	setZoom(value: ZoomValue): void;
	zoomBy(factor: number): void;
	/** Vertical, horizontal or wrapped, as Zotero's appearance popup offers. */
	setScrollMode(mode: ScrollModeName): void;
	/** Single pages, or facing pages starting on an odd or an even sheet. */
	setSpreadMode(mode: SpreadModeName): void;
	/** Turn every page, for a paper scanned sideways. */
	rotateBy(degrees: number): void;
	/**
	 * The page numbers the paper itself prints, when the file records them.
	 *
	 * Null when it does not, which is most papers — a PDF only carries these if
	 * whoever made it set them, and a journal offprint usually did.
	 */
	pageLabels(): Promise<(string | null)[] | null>;
	/**
	 * The paper's own table of contents, or an empty list when it has none.
	 *
	 * Most scanned papers have none; most typeset ones do.
	 */
	outline(): Promise<OutlineItem[]>;
	/** Follow one of its entries. */
	goToOutline(dest: unknown): void;
	/**
	 * A page drawn small, as a PNG data URL.
	 *
	 * Rendered from the document rather than cropped from the viewer's own
	 * canvas: a thumbnail is wanted for pages that are nowhere near the screen,
	 * and those have no canvas to crop.
	 */
	thumbnail(page: number, width: number): Promise<string | null>;
	/** Where the reader is now. Null before the pages exist. */
	place(): ReaderPlace | null;
	/** Back to somewhere it has been. */
	goToPlace(place: ReaderPlace): void;
	find(query: string, options?: { again?: boolean; backwards?: boolean }): void;
	clearFind(): void;
	/** A page's text, reconstructed by the same code that produced `chunks`. */
	pageText(page: number): Promise<string>;
	/** The same page as positioned lines, for placing marks made elsewhere. */
	pageLines(page: number): Promise<Line[]>;
	/** Annotations already in the file, made in some other tool. */
	pageAnnotations(page: number): Promise<PdfAnnotationLike[]>;
	viewportFor(page: number): ViewportLike | null;
	/**
	 * Where a page sits inside the scrolling content, and how to transform
	 * against it. Null while that page has not been laid out.
	 */
	frameFor(page: number): PageFrame | null;
	/**
	 * A PNG of one region of a page, as it is drawn.
	 *
	 * Null when that page has not been rendered — there is nothing to crop from
	 * a page that has not been painted yet.
	 */
	cropPage(page: number, region: Rect): Promise<Uint8Array | null>;
	readonly scale: number;
	readonly pages: number;
	readonly page: number;
	readonly rotation: number;
	readonly scrollMode: ScrollModeName;
	readonly spreadMode: SpreadModeName;
	destroy(): void;
}

export function createReaderViewer(
	container: HTMLDivElement,
	callbacks: ViewerCallbacks = {}
): ReaderViewer {
	const eventBus = new EventBus();
	const linkService = new PDFLinkService({ eventBus });
	const findController = new PDFFindController({ eventBus, linkService });

	const viewer = new PDFViewer({
		container,
		eventBus,
		linkService,
		findController
	});

	linkService.setViewer(viewer);

	let pdf: PDFDocumentProxy | null = null;
	let destroyed = false;

	const onPagesInit = () => {
		// 'auto' rather than a fixed scale: a two-column journal page and a
		// thesis page want very different zooms, and guessing one number for
		// both means the reader opens unreadable on one of them.
		viewer.currentScaleValue = 'auto';

		callbacks.onPagesLoaded?.(viewer.pagesCount);
		callbacks.onScale?.(viewer.currentScale);
		callbacks.onLayout?.();
	};
	const onPageChanging = (event: { pageNumber: number }) => callbacks.onPage?.(event.pageNumber);
	const onScaleChanging = () => {
		callbacks.onScale?.(viewer.currentScale);
		callbacks.onLayout?.();
	};
	const onPageRendered = () => callbacks.onLayout?.();
	const onRotation = () => callbacks.onLayout?.();
	const onFindMatches = (event: { matchesCount?: { total?: number; current?: number } }) =>
		callbacks.onFind?.({
			matches: event.matchesCount?.total ?? 0,
			current: event.matchesCount?.current ?? 0
		});

	/**
	 * Refit when the pane changes size.
	 *
	 * A named scale — 'auto', 'page-width' — is a statement about the container,
	 * and this container is a workspace pane. Dragging the split divider, or
	 * opening a second pane beside the manuscript, resizes it without a window
	 * resize, and a window resize is the only thing pdf.js watches. Without this
	 * a paper opened at full width stays at full width in half a pane, cut off
	 * down the right-hand side.
	 */
	const onResize = new ResizeObserver(() => {
		if (!pdf) return;

		const named = viewer.currentScaleValue;
		// Only a named value is relative to the container; a number the reader
		// chose is theirs to keep.
		if (named && Number.isNaN(Number(named))) viewer.currentScaleValue = named;

		viewer.update();
		callbacks.onLayout?.();
	});
	onResize.observe(container);

	eventBus.on('pagesinit', onPagesInit);
	eventBus.on('pagechanging', onPageChanging);
	eventBus.on('scalechanging', onScaleChanging);
	eventBus.on('pagerendered', onPageRendered);
	eventBus.on('rotationchanging', onRotation);
	eventBus.on('updatefindmatchescount', onFindMatches);
	eventBus.on('updatefindcontrolstate', onFindMatches);

	return {
		async load(data: Uint8Array) {
			const task = pdfjsLib.getDocument({
				data,
				cMapUrl: CMAP_URL,
				cMapPacked: true,
				standardFontDataUrl: STANDARD_FONT_URL
			});

			const loaded = await task.promise;

			// The reader may have been torn down while the bytes were in flight —
			// a fast tab switch is enough. Leaving the document attached would keep
			// a worker and its rendered pages alive for the rest of the session.
			if (destroyed) {
				void loaded.destroy();
				return;
			}

			pdf = loaded;
			viewer.setDocument(loaded);
			linkService.setDocument(loaded, null);
		},

		goToPage(page: number) {
			if (!pdf) return;
			viewer.currentPageNumber = Math.min(Math.max(1, Math.round(page)), viewer.pagesCount);
		},

		goTo(location: PdfLocation) {
			if (!pdf) return;

			const bounds = location.rects && boundingRect(location.rects);

			if (bounds) {
				// A destination in PDF user space, so the jump is correct at any
				// zoom. The margin keeps the passage off the very top edge, where
				// it reads as cut off rather than as the thing you asked for.
				viewer.scrollPageIntoView({
					pageNumber: location.page,
					destArray: [null, { name: 'XYZ' }, bounds.x, bounds.y + bounds.h + JUMP_MARGIN, null]
				});
				return;
			}

			const wanted = Math.min(Math.max(1, location.page), viewer.pagesCount);
			viewer.currentPageNumber = wanted;

			// No geometry, but a quote: let the find controller mark it. This is
			// what a citation gives us — `chunks` records the page and the text but
			// never the rectangles, because nobody drew them.
			if (!location.selector?.quote) return;

			// The page wins over the search.
			//
			// pdf.js searches the whole document and scrolls to its first match,
			// which is not necessarily on the page asked for: jumping to a passage
			// on page 5 whose wording also appears on page 7 lands on page 7, and
			// the citation looks wrong. The page came from the chunk that produced
			// the quote, so it is the more reliable of the two — the search is here
			// to mark the words, not to decide where to go.
			const restorePage = (event: { state?: number }) => {
				// Dispatched once when the search starts and again when it settles.
				// Only the settled one has scrolled anywhere, and acting on the
				// first would unregister this before the scroll it exists to undo.
				if (event?.state === FindState.PENDING) return;

				eventBus.off('updatefindcontrolstate', restorePage);
				if (viewer.currentPageNumber !== wanted) viewer.currentPageNumber = wanted;
			};
			eventBus.on('updatefindcontrolstate', restorePage);

			this.find(location.selector.quote.slice(0, 80));
		},

		setZoom(value: ZoomValue) {
			if (!pdf) return;
			viewer.currentScaleValue = typeof value === 'number' ? String(value) : value;
		},

		zoomBy(factor: number) {
			if (!pdf) return;
			viewer.currentScale = Math.min(10, Math.max(0.1, viewer.currentScale * factor));
		},

		setScrollMode(mode: ScrollModeName) {
			if (!pdf) return;
			viewer.scrollMode = SCROLL_MODES[mode];
			callbacks.onLayout?.();
		},

		setSpreadMode(mode: SpreadModeName) {
			if (!pdf) return;
			viewer.spreadMode = SPREAD_MODES[mode];
			callbacks.onLayout?.();
		},

		rotateBy(degrees: number) {
			if (!pdf) return;
			// pdf.js only accepts multiples of 90, and a negative rotation is the
			// same as its complement, so this is normalised rather than clamped.
			viewer.pagesRotation = (((viewer.pagesRotation + degrees) % 360) + 360) % 360;
			callbacks.onLayout?.();
		},

		async pageLabels() {
			if (!pdf) return null;
			return pdf.getPageLabels();
		},

		async outline() {
			if (!pdf) return [];

			const shape = (items: { title: string; dest: unknown; items?: unknown[] }[]): OutlineItem[] =>
				items.map((item) => ({
					title: item.title,
					dest: item.dest,
					children: shape((item.items ?? []) as { title: string; dest: unknown }[])
				}));

			const found = await pdf.getOutline();
			return found ? shape(found as never) : [];
		},

		goToOutline(dest: unknown) {
			if (!pdf) return;
			// Through the link service, which knows how to resolve a named
			// destination against the document's name tree.
			void linkService.goToDestination(dest as never);
		},

		async thumbnail(page: number, width: number) {
			if (!pdf) return null;

			const target = await pdf.getPage(page);
			const unscaled = target.getViewport({ scale: 1 });
			const viewport = target.getViewport({ scale: width / unscaled.width });

			const canvas = window.document.createElement('canvas');
			canvas.width = Math.ceil(viewport.width);
			canvas.height = Math.ceil(viewport.height);

			const context = canvas.getContext('2d');
			if (!context) return null;

			// White behind it: a PDF page is transparent where nothing is drawn, and
			// a transparent thumbnail over a dark panel is unreadable.
			context.fillStyle = '#ffffff';
			context.fillRect(0, 0, canvas.width, canvas.height);

			// `canvasContext` and `viewport` are the whole of this version's render
			// parameters; a `canvas` key would be silently dropped.
			await target.render({ canvasContext: context, viewport }).promise;

			return canvas.toDataURL('image/png');
		},

		place() {
			if (!pdf) return null;
			return {
				page: viewer.currentPageNumber,
				top: container.scrollTop,
				left: container.scrollLeft,
				scale: viewer.currentScale
			};
		},

		goToPlace(place: ReaderPlace) {
			if (!pdf) return;

			// The page first, which is right at any zoom, and the exact scroll only
			// when the zoom has not moved since — at a different scale those pixel
			// offsets point at a different part of the paper, and landing in the
			// wrong place is worse than landing at the top of the right page.
			viewer.currentPageNumber = Math.min(Math.max(1, place.page), viewer.pagesCount);

			if (Math.abs(place.scale - viewer.currentScale) < 0.001) {
				container.scrollTop = place.top;
				container.scrollLeft = place.left;
			}
		},

		find(query: string, options = {}) {
			eventBus.dispatch('find', {
				source: null,
				type: options.again ? 'again' : '',
				query,
				caseSensitive: false,
				entireWord: false,
				highlightAll: true,
				findPrevious: options.backwards ?? false,
				matchDiacritics: false
			});
		},

		clearFind() {
			eventBus.dispatch('findbarclose', { source: null });
		},

		async pageText(page: number) {
			if (!pdf) return '';
			return pageTextFrom(pdf as never, page);
		},

		async pageLines(page: number) {
			if (!pdf) return [];
			return pageLinesFrom(pdf as never, page);
		},

		async pageAnnotations(page: number) {
			if (!pdf) return [];
			const target = await pdf.getPage(page);
			return (await target.getAnnotations()) as PdfAnnotationLike[];
		},

		viewportFor(page: number) {
			const view = viewer.getPageView(page - 1);
			return view?.viewport ?? null;
		},

		async cropPage(page: number, region: Rect) {
			const view = viewer.getPageView(page - 1);
			const source = view?.canvas;
			if (!source || !view?.viewport) return null;

			// The canvas is drawn at the device pixel ratio, so its intrinsic size
			// is larger than its CSS size. Cropping in CSS pixels would take the
			// top-left quarter of the region on a retina screen — the ratio has to
			// come from the canvas itself rather than from devicePixelRatio, which
			// says nothing about what pdf.js actually chose.
			const box = rectToView(region, { transform: view.viewport.transform });
			const ratio = source.width / view.div.clientWidth;

			const width = Math.max(1, Math.round(box.width * ratio));
			const height = Math.max(1, Math.round(box.height * ratio));

			const crop = window.document.createElement('canvas');
			crop.width = width;
			crop.height = height;

			const context = crop.getContext('2d');
			if (!context) return null;

			context.drawImage(
				source,
				Math.round(box.left * ratio),
				Math.round(box.top * ratio),
				width,
				height,
				0,
				0,
				width,
				height
			);

			const blob = await new Promise<Blob | null>((resolve) => crop.toBlob(resolve, 'image/png'));
			if (!blob) return null;

			return new Uint8Array(await blob.arrayBuffer());
		},

		frameFor(page: number) {
			const view = viewer.getPageView(page - 1);
			if (!view?.div || !view.viewport) return null;

			// Measured against the scrolling container rather than read off
			// `offsetTop`, because pdf.js centres the viewer with margins and may
			// nest pages differently between scroll modes. Adding the scroll offset
			// turns a viewport-relative rectangle into one in content coordinates,
			// which is the frame the highlight layer is drawn in — so highlights
			// scroll with their page instead of floating over the window.
			const pageBox = view.div.getBoundingClientRect();
			const containerBox = container.getBoundingClientRect();

			return {
				page,
				bounds: {
					left: pageBox.left - containerBox.left + container.scrollLeft,
					top: pageBox.top - containerBox.top + container.scrollTop,
					width: pageBox.width,
					height: pageBox.height
				},
				viewport: view.viewport
			};
		},

		get scale() {
			return viewer.currentScale;
		},

		get pages() {
			return viewer.pagesCount;
		},

		get page() {
			return viewer.currentPageNumber;
		},

		get rotation() {
			return viewer.pagesRotation;
		},

		get scrollMode(): ScrollModeName {
			const found = Object.entries(SCROLL_MODES).find(([, value]) => value === viewer.scrollMode);
			return (found?.[0] as ScrollModeName) ?? 'vertical';
		},

		get spreadMode(): SpreadModeName {
			const found = Object.entries(SPREAD_MODES).find(([, value]) => value === viewer.spreadMode);
			return (found?.[0] as SpreadModeName) ?? 'none';
		},

		destroy() {
			destroyed = true;
			onResize.disconnect();

			eventBus.off('pagesinit', onPagesInit);
			eventBus.off('pagechanging', onPageChanging);
			eventBus.off('scalechanging', onScaleChanging);
			eventBus.off('pagerendered', onPageRendered);
			eventBus.off('rotationchanging', onRotation);
			eventBus.off('updatefindmatchescount', onFindMatches);
			eventBus.off('updatefindcontrolstate', onFindMatches);

			viewer.setDocument(null as never);
			linkService.setDocument(null);

			void pdf?.destroy();
			pdf = null;
		}
	};
}
