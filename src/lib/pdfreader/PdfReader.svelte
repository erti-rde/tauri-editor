<script lang="ts">
	import { onDestroy, untrack } from 'svelte';

	import { call, commands } from '$lib/ipc';

	import ReaderSidebar, { type SidebarTab } from './ReaderSidebar.svelte';
	import HighlightLayer from './HighlightLayer.svelte';
	import AdjustHandles from './AdjustHandles.svelte';
	import FieldEditor from './FieldEditor.svelte';
	import MarkMenu from './MarkMenu.svelte';
	import AnnotationPopup from './AnnotationPopup.svelte';
	import PdfToolbar from './PdfToolbar.svelte';
	import SelectionMenu from './SelectionMenu.svelte';
	import { collectImportable, importKey, type ImportCandidate } from './importAnnotations';
	import { caretAtPoint, rangeFrom, readSelection, type SelectionAnchor } from './selection';
	import { readerStore, type ReaderHandle } from './readerStore';
	import {
		createReaderViewer,
		type FindSummary,
		type OutlineItem,
		type ReaderPlace,
		type ReaderViewer,
		type ScrollModeName,
		type SpreadModeName
	} from './viewer';
	import { dragsABox, NOTE_SIZE, placesANote, styleOf, type ReaderTool } from './tools';
	import { createLineCache, snapToLines, type TypeLine } from './typeset';
	import type { PageTheme } from './AppearanceMenu.svelte';

	import { annotationsStore, colourFor, pageLabelOf } from '$lib/stores/annotations.svelte';
	import type { Annotation, MarkStyle } from '$lib/stores/db';
	import { annotationImage, saveAnnotationImage } from '$lib/stores/db';
	import { save } from '@tauri-apps/plugin-dialog';
	import { writeFile } from '@tauri-apps/plugin-fs';
	import { errorToast, successToast } from '$lib/toast/Toast.svelte';
	import {
		boundingRect,
		clientRectsToPdf,
		contextAround,
		locateQuote,
		pdfRectsToClient,
		toContentSpace,
		type ClientRectLike,
		type PageFrame,
		type PdfLocation,
		type Rect
	} from './location';

	/**
	 * A paper, on screen.
	 *
	 * This was an iframe around pdf.js's stock viewer application, which rendered
	 * papers perfectly well and told the rest of the app nothing about them. No
	 * selection, no page number and no coordinates crossed the frame boundary, so
	 * nothing noticed while reading could be kept, and a citation could not point
	 * at the place it came from.
	 *
	 * The viewer is now assembled from pdf.js's own components in `viewer.ts`,
	 * which keeps the library doing the rendering while the selection and the
	 * chrome stay on this side.
	 */
	interface Props {
		path: string;
		/** Which pane this reader is in, so a jump can land in the right one. */
		paneId: string;
	}

	const { path, paneId }: Props = $props();

	let container: HTMLDivElement | undefined = $state();

	let loading = $state(true);
	let error: string | null = $state(null);
	let page = $state(1);
	let pages = $state(0);
	let scale = $state(1);
	let findState: FindSummary | null = $state(null);
	let searching = $state(false);

	let viewer = $state<ReaderViewer | null>(null);
	let handle: ReaderHandle | null = null;

	/**
	 * Bumped whenever the pages move, so the marks drawn over them re-measure.
	 * Scrolling is not one of those: the layer works in the content's own
	 * coordinates, which scrolling does not change.
	 */
	let layout = $state(0);

	let selecting: { anchors: SelectionAnchor[]; quote: string; focus: ClientRectLike } | null =
		$state(null);

	/**
	 * Where each page's lines sit, so a mark can be put on the words.
	 *
	 * A browser measures line boxes, which are taller than the letters and sit
	 * higher than them; the paper knows where its baselines are. Kept per page
	 * because it costs a text-content fetch, and a reader marks the same page
	 * several times over.
	 */
	const lineCache = createLineCache();

	async function linesFor(page: number): Promise<TypeLine[]> {
		const known = lineCache.peek(page);
		if (known) return known;

		try {
			const lines: TypeLine[] = await viewer!.pageLines(page);
			lineCache.remember(page, lines);
			return lines;
		} catch (failure) {
			// A page whose text cannot be read still gets its mark, drawn on the
			// browser's own measurement. Loosely placed beats absent.
			console.error('Could not read the lines of this page:', failure);
			lineCache.remember(page, []);
			return [];
		}
	}

	/** Ringed briefly after a jump, so the passage says where it is. */
	let flashing: string | null = $state(null);

	/**
	 * The mark under the pointer.
	 *
	 * Worked out here because the marks cannot answer for themselves: they take
	 * no pointer events, so `:hover` never fires on one.
	 */
	let hovering: string | null = $state(null);

	/**
	 * The panel beside the paper, and which of its three answers is showing.
	 *
	 * Closed to begin with: a paper is opened to be read, and 16rem of chrome
	 * before anyone has asked for it is 16rem less paper.
	 */
	let sidebarOpen = $state(false);
	let sidebarTab = $state<SidebarTab>('thumbnails');

	/** The paper's own table of contents, when it has one. */
	let contents = $state<OutlineItem[]>([]);

	/** Bumped when a different paper loads, so its pictures are dropped. */
	let document_ = $state(0);

	/**
	 * The mark just made, so the panel can make sure it is visible.
	 *
	 * A new mark landing under a filter that hides it, or below the fold of a
	 * long list, reads as not having been saved at all.
	 */
	let justMade = $state<string | null>(null);

	/**
	 * What the reader has in hand, or null for nothing.
	 *
	 * One tool at a time, as in Zotero. With a marking tool chosen, selecting text
	 * marks it straight away — which is what a mode is for, and what makes reading
	 * with a highlighter in hand feel like anything. With none chosen, the popup
	 * comes up and the choice is made per passage. Forcing a mode on someone who
	 * only wanted to copy a sentence is the thing to avoid.
	 */
	let tool = $state<ReaderTool>(null);

	/** How a marking tool draws, or null when the tool in hand is not one. */
	const markStyle = $derived(styleOf(tool));

	/**
	 * The style the popup will use, when it is the one doing the asking.
	 *
	 * Kept apart from the toolbar mode on purpose: choosing "underline" for one
	 * passage should not silently arm underlining for the rest of the afternoon.
	 */
	let pendingStyle = $state<MarkStyle>('fill');

	/**
	 * The mark the reader has picked up.
	 *
	 * One idea where there were two. Re-drawing a mark used to be a mode entered
	 * from a menu, with a banner and a Done button, and the only way out was
	 * Escape — which is a lot of apparatus for "the ends can be dragged". Zotero
	 * has none of it: a selected annotation is drawn with a dashed outline and a
	 * caret at each end, and those carets are simply draggable for as long as it
	 * is selected. Clicking somewhere else puts it down.
	 */
	let selected = $state<Annotation | null>(null);
	/** Its live extent while an end is being dragged, in PDF user space. */
	let adjustRects = $state<Rect[]>([]);
	let adjustQuote = $state('');
	/** Which end is under the pointer, or null between drags. */
	let dragging = $state<'start' | 'end' | null>(null);
	/**
	 * The end that is standing still, as a position in the document.
	 *
	 * A position rather than a pixel. The first version held both ends as window
	 * coordinates and re-hit-tested them on every move, which meant the anchor
	 * drifted by a character each time the pointer passed the middle of a glyph
	 * and moved out from under the passage entirely if the page scrolled. A DOM
	 * position is the thing itself and does not move.
	 */
	let adjustAnchor: Range | null = null;

	/** Where the selected mark's popup hangs. Measured once, so it holds still. */
	let popupAt = $state<ClientRectLike | null>(null);

	/**
	 * The mark whose printed page number is being corrected.
	 *
	 * The quoted text used to be correctable here too. It is not any more: the
	 * carets at either end of a mark say what it covers, and re-drawing it
	 * re-derives the words — so a second way to change them was a second answer
	 * to the same question, and the two could disagree.
	 */
	let editing = $state<{ mark: Annotation } | null>(null);

	/**
	 * Where the mark being adjusted currently sits.
	 *
	 * Reads `layout` so the handles follow the page when it is zoomed or
	 * re-rendered, rather than staying where the text used to be.
	 */
	const adjustFrame = $derived.by(() => {
		void layout;
		return selected && viewer ? viewer.frameFor(selected.page) : null;
	});

	/** The mark whose menu is open, and where to put it. */
	let chosen = $state<{ mark: Annotation; at: ClientRectLike } | null>(null);

	/** Marks found in the file itself, made in some other tool, not yet brought in. */
	let offered = $state<ImportCandidate[]>([]);
	let importing = $state(false);

	/** Dragging a box over a figure rather than selecting words. */
	let dragFrom = $state<{ x: number; y: number } | null>(null);
	let dragTo = $state<{ x: number; y: number } | null>(null);

	/**
	 * How the pages are laid out, mirrored from the viewer.
	 *
	 * pdf.js owns these; this is a copy kept so the popup can show which one is
	 * in force. Reading them off the viewer inside a `$derived` would not
	 * re-derive, because nothing about pdf.js is reactive.
	 */
	let scrollMode = $state<ScrollModeName>('vertical');
	let spreadMode = $state<SpreadModeName>('none');
	let rotation = $state(0);
	let pageTheme = $state<PageTheme>('paper');

	/**
	 * The page numbers this paper prints, when the file records them.
	 *
	 * Most PDFs carry nothing here and the sheet number is all there is. A
	 * journal offprint usually does carry them, and then they are the numbers a
	 * citation has to use — so the toolbar shows them, and a mark made on such a
	 * page takes its printed number without anyone being asked.
	 */
	let labelsForPages = $state<(string | null)[] | null>(null);

	const pageLabel = $derived(labelsForPages?.[page - 1] ?? null);

	/**
	 * Where the reader has jumped from, so it can go back.
	 *
	 * Following a citation into page 41 and then having to find the way back to
	 * page 3 by hand is what stops people following citations at all. Only real
	 * jumps are recorded — scrolling is not one, because a back button that
	 * undoes scrolling is a back button nobody can predict.
	 */
	let history = $state<ReaderPlace[]>([]);

	const dragBox = $derived(
		dragFrom && dragTo
			? {
					left: Math.min(dragFrom.x, dragTo.x),
					top: Math.min(dragFrom.y, dragTo.y),
					width: Math.abs(dragTo.x - dragFrom.x),
					height: Math.abs(dragTo.y - dragFrom.y)
				}
			: null
	);

	/**
	 * Which load is the current one.
	 *
	 * Switching tabs quickly starts a second read before the first returns, and
	 * without this the slower one wins and the pane shows the paper you just
	 * navigated away from.
	 */
	let generation = 0;

	function navigate(location: PdfLocation) {
		rememberPlace();
		viewer?.goTo(location);
	}

	/**
	 * Note where the reader is, before taking them somewhere else.
	 *
	 * Bounded rather than unbounded: a back button is for undoing the jump you
	 * just made, not for retracing an afternoon, and an unbounded stack in a
	 * component that lives as long as a tab is a slow leak.
	 */
	function rememberPlace() {
		const place = viewer?.place();
		if (!place) return;

		history = [...history, place].slice(-20);
	}

	function goBack() {
		const place = history.at(-1);
		if (!place) return;

		history = history.slice(0, -1);
		viewer?.goToPlace(place);
	}

	/**
	 * A page box entry, which may be a printed page number rather than a sheet.
	 *
	 * The printed number is tried first, because that is what the box shows and
	 * therefore what a reader typing into it means. Falling through to the sheet
	 * number keeps a plain "12" working in a paper whose labels are roman
	 * numerals, where 12 is not a label at all.
	 */
	function goToValue(value: string) {
		const wanted = value.trim();
		if (!wanted || !viewer) return;

		rememberPlace();

		const printed = labelsForPages?.findIndex((label) => label === wanted) ?? -1;
		if (printed >= 0) {
			viewer.goToPage(printed + 1);
			return;
		}

		const sheet = Number(wanted);
		if (Number.isFinite(sheet) && sheet >= 1) viewer.goToPage(sheet);
	}

	$effect(() => {
		const element = container;
		const wanted = path;
		if (!element) return;

		untrack(() => void open(element, wanted));
	});

	async function open(element: HTMLDivElement, pdfPath: string) {
		const mine = ++generation;

		teardown();
		loading = true;
		error = null;
		findState = null;

		const created = createReaderViewer(element, {
			onPage(next) {
				if (mine !== generation) return;
				page = next;
				handle?.report({ page: next });
				readerStore.remember(pdfPath, next);
			},
			onPagesLoaded(count) {
				if (mine !== generation) return;
				pages = count;
				handle?.report({ pages: count });

				// Done here rather than straight after `load` because the pages do
				// not exist to scroll to until pdf.js has laid them out.
				//
				// A jump asked for while this paper was still closed wins over the
				// remembered place: someone followed a citation to a passage, and
				// landing where they last stopped reading instead would look like
				// the link had failed.
				const asked = readerStore.takeJump(pdfPath);
				if (asked) {
					created.goTo(asked);
					return;
				}

				const remembered = readerStore.recall(pdfPath);
				if (remembered && remembered > 1) created.goToPage(remembered);

				void lookForExisting(mine);
			},
			onScale(next) {
				if (mine !== generation) return;
				scale = next;
			},
			onFind(summary) {
				if (mine !== generation) return;
				findState = summary;
			},
			onLayout() {
				if (mine !== generation) return;
				layout += 1;
			}
		});

		viewer = created;
		handle = readerStore.register({ paneId, path: pdfPath, navigate });

		// The marks are loaded alongside the bytes rather than after them: they are
		// keyed by the library's hash of the file, which does not depend on the
		// viewer having finished anything.
		void annotationsStore.openPath(pdfPath);

		try {
			// Awaited, so a failure lands in the catch below rather than surfacing
			// as an unhandled rejection while the pane sits on an empty viewer.
			const encoded = await call(commands.readPdfFile(pdfPath));
			if (mine !== generation) return;

			await created.load(base64ToUint8Array(encoded));
			if (mine !== generation) return;

			// Asked for once the document exists, and allowed to fail quietly: a
			// file without them is the ordinary case, not a fault.
			try {
				const printed = await created.pageLabels();
				if (mine === generation) labelsForPages = printed;
			} catch (failure) {
				console.error('Could not read the printed page numbers:', failure);
			}

			try {
				const found = await created.outline();
				if (mine === generation) contents = found;
			} catch (failure) {
				// A paper without one is the ordinary case, not a fault.
				console.error('Could not read the table of contents:', failure);
			}

			if (mine === generation) document_ += 1;
		} catch (failure) {
			if (mine !== generation) return;

			console.error('Could not open the PDF:', failure);
			error = failure instanceof Error ? failure.message : String(failure);
		} finally {
			if (mine === generation) loading = false;
		}
	}

	function teardown() {
		selecting = null;
		chosen = null;
		popupAt = null;
		editing = null;
		selected = null;
		adjustRects = [];
		adjustAnchor = null;
		dragging = null;
		hovering = null;
		contents = [];
		justMade = null;
		frameMemo = null;
		lineCache.clear();
		history = [];
		labelsForPages = null;
		offered = [];
		handle?.release();
		handle = null;
		viewer?.destroy();
		viewer = null;
	}

	onDestroy(() => {
		generation++;
		teardown();
	});

	/**
	 * The pages a selection could plausibly be on.
	 *
	 * Measuring every page would mean a `getBoundingClientRect` per page on every
	 * mouse release — three hundred of them in a thesis, for a selection that can
	 * only ever touch the two or three pages on screen.
	 */
	function nearbyFrames(): PageFrame[] {
		if (!viewer) return [];

		const frames: PageFrame[] = [];
		// No upper clamp against the page count: `frameFor` already answers null
		// for a page that is not laid out, and clamping against a separate counter
		// meant this returned nothing at all whenever that counter was behind.
		for (let n = Math.max(1, page - 2); n <= page + 2; n++) {
			const frame = viewer.frameFor(n);
			if (frame) frames.push(frame);
		}
		return frames;
	}

	/**
	 * Which mark is under a point, worked out from the rectangles rather than
	 * from the DOM.
	 *
	 * The layer that draws them cannot answer this: an element over the words is
	 * an element in the way of them, and letting the marks take the pointer is
	 * what broke dragging a selection across a highlight. The geometry is already
	 * stored, so asking it directly costs nothing and puts nothing on the page.
	 *
	 * Later marks win, because later marks are drawn on top.
	 */
	function markAt(point: { x: number; y: number }): Annotation | null {
		const frames = new Map(framesNearby().map((frame) => [frame.page, frame]));
		const marks = $annotationsStore.annotations;

		for (let index = marks.length - 1; index >= 0; index--) {
			const annotation = marks[index];
			const frame = frames.get(annotation.page);
			if (!frame) continue;

			const rects = rectsOf(annotation);
			if (rects.length === 0) continue;

			for (const box of pdfRectsToClient(rects, frame)) {
				const left = frame.bounds.left + box.left;
				const top = frame.bounds.top + box.top;

				if (
					point.x >= left &&
					point.x <= left + box.width &&
					point.y >= top &&
					point.y <= top + box.height
				) {
					return annotation;
				}
			}
		}

		return null;
	}

	/**
	 * The nearby pages, measured once per layout.
	 *
	 * `markAt` runs on every pointer move so the hover state can follow the
	 * pointer, and measuring five page elements per move is five layout reads for
	 * an answer that only changes when the pages do. Scrolling is not one of
	 * those: these are content coordinates, which scrolling leaves alone.
	 */
	let frameMemo: { key: string; frames: PageFrame[] } | null = null;

	function framesNearby(): PageFrame[] {
		const key = `${layout}:${page}:${pages}`;
		if (frameMemo?.key === key) return frameMemo.frames;

		const frames = nearbyFrames();
		frameMemo = { key, frames };
		return frames;
	}

	function onSelectionChanged(event?: Event) {
		if (!container || !viewer) return;

		// Only the primary button ends a selection.
		//
		// A right click leaves the selection exactly where it was, and its release
		// was being read as though the reader had just made it — so asking a mark
		// what could be done to it raised the passage popup as well, two menus
		// over one highlight.
		if (event instanceof MouseEvent && event.button !== 0) return;

		// A press inside the menu is not a new selection. `mouseup` arrives before
		// `click`, so clearing here would take the button out from under the press
		// and the highlight would never be made.
		if (
			event?.target instanceof Element &&
			event.target.closest('[data-selection-menu]') !== null
		) {
			return;
		}

		const read = readSelection(container, nearbyFrames());

		// A tool in hand means the choice has already been made, so making it
		// again per passage would be asking twice. Adjusting is its own thing and
		// keeps the popup, because there the selection is an answer to a question.
		if (read && markStyle && !selected) {
			selecting = read;
			void mark($annotationsStore.lastLabel, false);
			return;
		}

		selecting = read;
	}

	/**
	 * Watch for a finished selection.
	 *
	 * Bound here rather than as attributes because this is not the pages being
	 * operated: nothing is being clicked, the selection is simply being read once
	 * the reader stops dragging. `selectionchange` on the document would fire on
	 * every character as a drag grows, so the menu would chase the pointer.
	 */
	$effect(() => {
		const element = container;
		if (!element) return;

		const onKeyUp = (event: KeyboardEvent) => {
			if (event.key === 'Escape') deselect();
			if (event.shiftKey || event.key === 'Escape') onSelectionChanged(event);
		};

		/**
		 * Ctrl+Z, or Cmd+Z on a Mac.
		 *
		 * Bound to the pages rather than the window: a manuscript in the other
		 * pane has its own undo, and a keystroke aimed at one must never reach into
		 * the other. Which of the two the reader means is answered by where they
		 * are typing, which is what focus is for.
		 *
		 * Shift+Ctrl+Z is left alone rather than made a redo. Undo here reverses
		 * the wrong turn you notice at once; a redo would invite treating it as a
		 * history of the paper, and these marks are shared by every project that
		 * opens it.
		 */
		const onKeyDown = (event: KeyboardEvent) => {
			const undoing = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z';
			if (!undoing || event.shiftKey || event.altKey) return;

			event.preventDefault();
			void undoLast();
		};

		/** Where the press started, and whether it has turned into a drag. */
		let pressedAt: { x: number; y: number } | null = null;
		let swept = false;
		/**
		 * A release that ended a drag of the mark's ends.
		 *
		 * The click that follows it is not the reader clicking on the paper, and
		 * treating it as one put the mark down the instant it had been re-drawn —
		 * which for a mark that was shortened is every time, because the pointer
		 * ends up beyond its new edge.
		 */
		let justDragged = false;

		const inPopup = (event: Event) =>
			event.target instanceof Element &&
			event.target.closest('[data-mark-menu], [data-selection-menu]') !== null;

		const onPointerDown = (event: PointerEvent) => {
			// Anywhere but inside a popup dismisses it. Tested by target rather
			// than by letting the popup stop the event: Svelte delegates
			// `pointerdown` to the document root, so the popup's own handler runs
			// after this one and the button would be gone before the click landed.
			if (!inPopup(event)) {
				chosen = null;
				// The selection popup sits over the passage it is about, so leaving
				// it up would put it in the way of the next thing being selected.
				selecting = null;
			}

			if (event.button !== 0) return;

			// An end of the mark in hand, which is draggable for as long as it is
			// held. Checked before anything else, because a press here is neither
			// a selection nor a click on the paper.
			const end = handleAt(pointIn(event));
			if (end) {
				event.preventDefault();
				grabHandle(end);
				return;
			}

			justDragged = false;

			pressedAt = { x: event.clientX, y: event.clientY };
			swept = false;

			// A note goes where it is put. Zotero's note tool works the same way,
			// and it is the one annotation that is about a place on the page rather
			// than about anything printed there.
			if (placesANote(tool)) {
				event.preventDefault();
				void noteAt(pointIn(event));
				return;
			}

			if (!dragsABox(tool)) return;
			// Stops the drag turning into a text selection underneath.
			event.preventDefault();
			dragFrom = pointIn(event);
			dragTo = dragFrom;
			element.setPointerCapture(event.pointerId);
		};

		const onPointerMove = (event: PointerEvent) => {
			if (dragFrom) {
				dragTo = pointIn(event);
				return;
			}

			if (pressedAt) {
				// Far enough to be a drag rather than an unsteady click. Past this
				// point the press is sweeping out a selection, and the click that
				// follows it must not be read as pointing at anything.
				if (
					Math.abs(event.clientX - pressedAt.x) > 4 ||
					Math.abs(event.clientY - pressedAt.y) > 4
				) {
					swept = true;
				}
				return;
			}

			// Nothing to be over, so nothing to measure. Worth the guard: this runs
			// on every pointer move across the paper.
			if ($annotationsStore.annotations.length === 0) return;

			hovering = markAt(pointIn(event))?.id ?? null;
		};

		const onPointerLeave = () => (hovering = null);

		const onPointerUp = (event: PointerEvent) => {
			pressedAt = null;

			if (!dragFrom) return;

			const box = dragBox;
			dragFrom = null;
			dragTo = null;
			tool = null;
			if (element.hasPointerCapture(event.pointerId)) {
				element.releasePointerCapture(event.pointerId);
			}

			if (box) void snapshot(box);
		};

		/**
		 * A click on the page, which may be a click on a mark.
		 *
		 * Answered here rather than by the marks themselves, which take no
		 * pointer: an element drawn over the words is an element in the way of
		 * selecting them. A click that ended a drag is not pointing at anything,
		 * so it is left alone.
		 */
		const onClick = (event: MouseEvent) => {
			if (justDragged) {
				justDragged = false;
				return;
			}

			if (swept || inPopup(event) || tool !== null) return;

			const found = markAt(pointIn(event as unknown as PointerEvent));

			// Clicking bare paper puts down whatever was in hand. This is what
			// re-drawing a mark used to need Escape for: it was a mode rather than
			// a selection, so nothing else could end it.
			if (!found) {
				deselect();
				return;
			}

			chosen = null;
			select(found);
		};

		const onContextMenu = (event: MouseEvent) => {
			if (inPopup(event)) return;

			const found = markAt(pointIn(event as unknown as PointerEvent));
			if (!found) return;

			// The reader's own menu instead of the webview's, which offers nothing
			// useful over a highlight. The mark is picked up as well, so its ends
			// are draggable and the outline says which one the menu is about.
			event.preventDefault();
			select(found, { popup: false });
			chosen = { mark: found, at: pointerBox({ x: event.clientX, y: event.clientY }) };
		};

		/**
		 * Finished on the window, not on the pages.
		 *
		 * A selection dragged upwards very often ends with the pointer released
		 * above the pane — over the toolbar, or outside the window entirely — and
		 * a release the reader never hears about leaves the press state set and
		 * the passage unread.
		 */
		const onWindowUp = (event: PointerEvent) => {
			if (dragging) {
				justDragged = true;
				void endAdjust();
			}
			onPointerUp(event);
			swept = false;
		};

		/**
		 * Follow a handle on the window rather than on the handle.
		 *
		 * A drag that only listened on the element it started from would stop the
		 * moment the pointer left it, and pointer capture cannot be used instead:
		 * capture and `pointer-events: none` are the same mechanism arguing with
		 * each other, and the handle has to leave the hit test for the drag to be
		 * able to ask what is under the pointer at all.
		 *
		 * Bound for the life of the reader and guarded by `dragging`, rather than
		 * attached when a drag begins. Attaching on demand made the listener's
		 * existence depend on an effect having flushed, and a pointer that moved
		 * before it did was simply not heard — which is a drag that sometimes does
		 * nothing, for no reason the reader could see.
		 */
		const onWindowMove = (event: PointerEvent) => {
			if (!dragging) return;
			onHandleDrag({ x: event.clientX, y: event.clientY });
		};

		// The releases are heard on the window rather than on the pages.
		//
		// A selection dragged upwards very often ends with the pointer released
		// above the pane — over the toolbar, or outside the window entirely — and
		// a release the reader never hears about leaves the press state set and
		// the passage unread. Releases inside the pane bubble up here too, so the
		// pages need no listener of their own for these.
		element.addEventListener('keyup', onKeyUp);
		element.addEventListener('keydown', onKeyDown);
		element.addEventListener('pointerdown', onPointerDown);
		element.addEventListener('pointermove', onPointerMove);
		element.addEventListener('click', onClick);
		element.addEventListener('contextmenu', onContextMenu);
		element.addEventListener('pointerleave', onPointerLeave);
		window.addEventListener('mouseup', onSelectionChanged);
		window.addEventListener('pointermove', onWindowMove);
		window.addEventListener('pointerup', onWindowUp);
		window.addEventListener('pointercancel', onWindowUp);

		return () => {
			element.removeEventListener('keyup', onKeyUp);
			element.removeEventListener('keydown', onKeyDown);
			element.removeEventListener('pointerdown', onPointerDown);
			element.removeEventListener('pointermove', onPointerMove);
			element.removeEventListener('click', onClick);
			element.removeEventListener('contextmenu', onContextMenu);
			element.removeEventListener('pointerleave', onPointerLeave);
			window.removeEventListener('mouseup', onSelectionChanged);
			window.removeEventListener('pointermove', onWindowMove);
			window.removeEventListener('pointerup', onWindowUp);
			window.removeEventListener('pointercancel', onWindowUp);
		};
	});

	/**
	 * Turn a selection into marks and save them.
	 *
	 * The offsets into the reconstructed page text are worked out here rather than
	 * at read time, while the page is in hand and the answer is unambiguous. They
	 * are what will let a mark be matched to the chunk it sits in — the same text
	 * `chunks.char_start` indexes — so a note can be found by meaning later.
	 */
	/**
	 * Everything a mark needs to be found again, worked out while the page is in
	 * hand and the answer is unambiguous.
	 *
	 * The offsets index the same reconstructed text `chunks.char_start` does, so
	 * a mark can later be matched to the chunk it sits in.
	 */
	async function anchorFor(anchor: SelectionAnchor) {
		// Put on the words before anything else, so what is stored is what will be
		// drawn — at any zoom, on any machine, and in an export.
		const rects = snapToLines(anchor.rects, await linesFor(anchor.page));

		let prefix: string | undefined;
		let suffix: string | undefined;
		let charStart: number | null = null;
		let charEnd: number | null = null;

		try {
			const text = await viewer!.pageText(anchor.page);
			const found = locateQuote(text, { quote: anchor.quote });
			if (found) {
				charStart = found.start;
				charEnd = found.end;
				const context = contextAround(text, found.start, found.end);
				prefix = context.prefix;
				suffix = context.suffix;
			}
		} catch (failure) {
			// A page whose text cannot be read still gets its rectangles, which are
			// what draw the mark. Only finding it again later is weaker.
			console.error('Could not read the page text for this mark:', failure);
		}

		return {
			page: anchor.page,
			// The number the paper prints, when the file says what it is. This is
			// the one a citation has to carry, and taking it from the file means
			// nobody has to notice that a paper begins at page 843.
			page_label: labelsForPages?.[anchor.page - 1] ?? null,
			rects: JSON.stringify(rects),
			quote: anchor.quote,
			prefix,
			suffix,
			char_start: charStart,
			char_end: charEnd
		};
	}

	async function mark(labelId: string | null, withNote: boolean) {
		const current = selecting;
		if (!current || !viewer) return;

		// Cleared first: saving is async, and leaving the menu up over a selection
		// that has already been marked invites marking it twice.
		selecting = null;
		window.getSelection()?.removeAllRanges();

		for (const anchor of current.anchors) {
			const id = crypto.randomUUID();
			justMade = id;

			await annotationsStore.save(
				{
					id,
					sha256: $annotationsStore.sha256 ?? '',
					kind: 'highlight',
					style: markStyle ?? pendingStyle,
					label_id: labelId,
					note: withNote ? '' : null,
					...(await anchorFor(anchor))
				},
				(markStyle ?? pendingStyle) === 'underline' ? 'the underline' : 'the highlight'
			);
		}
	}

	/**
	 * Put an area snapshot on the clipboard.
	 *
	 * The picture, not a reference to it — a figure copied out of a paper is
	 * meant to land in a slide or a message, and neither can follow a link into
	 * somebody's library.
	 */
	async function copyImage(mark: Annotation) {
		try {
			const bytes = await annotationImage(mark.id);
			if (!bytes) {
				errorToast('That mark has no picture kept with it.');
				return;
			}

			const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
			successToast('Copied the picture.');
		} catch (failure) {
			console.error('Could not copy that picture:', failure);
			errorToast('Could not copy that picture.');
		}
	}

	async function saveImage(mark: Annotation) {
		try {
			const bytes = await annotationImage(mark.id);
			if (!bytes) {
				errorToast('That mark has no picture kept with it.');
				return;
			}

			const target = await save({
				defaultPath: `figure-p${mark.page_label ?? mark.page}.png`,
				filters: [{ name: 'PNG image', extensions: ['png'] }]
			});
			if (!target) return;

			await writeFile(target, new Uint8Array(bytes));
			successToast('Saved the picture.');
		} catch (failure) {
			console.error('Could not save that picture:', failure);
			errorToast('Could not save that picture.');
		}
	}

	/** Where a mark sits, for hanging a popup under it. */
	function markBox(mark: Annotation): ClientRectLike | null {
		if (!viewer) return null;

		const frame = viewer.frameFor(mark.page);
		const rects = rectsOf(mark);
		if (!frame) return null;

		const bounds = boundingRect(rects);
		if (!bounds) {
			// A page note has no rectangles; hang it near the top of its page.
			return { left: frame.bounds.left + 24, top: frame.bounds.top + 24, width: 0, height: 0 };
		}

		const box = pdfRectsToClient([bounds], frame)[0];
		return {
			left: frame.bounds.left + box.left,
			top: frame.bounds.top + box.top,
			width: box.width,
			height: box.height
		};
	}

	/** A right-click lands where the pointer is, in content coordinates. */
	function pointerBox(at: { x: number; y: number }): ClientRectLike {
		const bounds = container!.getBoundingClientRect();
		return {
			left: at.x - bounds.left + container!.scrollLeft,
			top: at.y - bounds.top + container!.scrollTop,
			width: 0,
			height: 0
		};
	}

	/** Client coordinates of a content-space point. */
	function toWindow(point: { left: number; top: number }) {
		const bounds = container!.getBoundingClientRect();
		return {
			x: point.left + bounds.left - container!.scrollLeft,
			y: point.top + bounds.top - container!.scrollTop
		};
	}

	/**
	 * Start re-drawing a mark by its ends.
	 *
	 * Only arms it. Which end is fixed is not known until one of them is picked
	 * up, and resolving both here would mean hit-testing through a highlight that
	 * is still taking clicks — which is what made the first version of this
	 * refuse to move at all.
	 */
	/**
	 * Pick a mark up.
	 *
	 * Selecting is all it takes to be able to re-draw it: the carets at either
	 * end are live from this moment, with no mode to enter and nothing to
	 * dismiss afterwards.
	 */
	function select(mark: Annotation, { popup = true }: { popup?: boolean } = {}) {
		// Any text still selected is dropped.
		//
		// A mark is drawn with `multiply` so the words underneath stay readable,
		// and the webview's own selection blends into it — a yellow highlight
		// under a blue selection comes out muddy orange, which reads as the mark
		// having lost its colour until you click somewhere else. Picking a mark up
		// is the end of whatever was selected anyway.
		window.getSelection()?.removeAllRanges();

		// Warmed for the drag, which is synchronous and cannot wait for it.
		void linesFor(mark.page);

		selected = mark;
		adjustRects = rectsOf(mark);
		adjustQuote = mark.quote ?? '';
		adjustAnchor = null;
		dragging = null;
		// The card is the left button's answer. On the right button the menu is
		// the answer, and raising both puts two things over one mark — which is
		// the "two popups" this had before, in its second form.
		popupAt = popup ? markBox(mark) : null;
	}

	/** Put it down. */
	function deselect() {
		selected = null;
		popupAt = null;
		adjustRects = [];
		adjustAnchor = null;
		dragging = null;
	}

	/**
	 * Pick up one end.
	 *
	 * The other end is resolved to a position in the document here, once, and
	 * held for the rest of the drag. `tick()` first because both the handles and
	 * the mark itself have to leave the hit test before anything can be asked
	 * about the words underneath them — `dragging` is what does that, and it has
	 * to have reached the DOM before the question is put.
	 */
	/**
	 * Where the two ends of the mark in hand are, in content coordinates.
	 *
	 * Null when nothing is in hand, or when its page has not been laid out.
	 */
	function handleEnds() {
		if (!selected || !viewer) return null;

		const frame = viewer.frameFor(selected.page);
		if (!frame) return null;

		const boxes = pdfRectsToClient(adjustRects, frame);
		if (boxes.length === 0) return null;

		const first = boxes[0];
		const last = boxes[boxes.length - 1];

		return {
			frame,
			start: {
				x: frame.bounds.left + first.left,
				top: frame.bounds.top + first.top,
				height: first.height
			},
			end: {
				x: frame.bounds.left + last.left + last.width,
				top: frame.bounds.top + last.top,
				height: last.height
			}
		};
	}

	/** How near a caret counts as grabbing it. A two-pixel bar is not a target. */
	const HANDLE_REACH = 12;

	/**
	 * Which end of the mark a press landed on, worked out from the geometry.
	 *
	 * The same arrangement the marks themselves use, and for the same reason: an
	 * element that takes the pointer is an element in the way of the words. Here
	 * it also removes a race that made the gesture unreliable — the drag has to
	 * ask what is under the far end of the passage, and while the handles were
	 * pointer targets that answer was "the other handle" until a Svelte flush had
	 * taken them out of the way. Whether the flush won was down to timing, which
	 * is a drag that sometimes does nothing.
	 */
	function handleAt(point: { x: number; y: number }): 'start' | 'end' | null {
		if (!selected || selected.kind !== 'highlight') return null;

		const ends = handleEnds();
		if (!ends) return null;

		for (const which of ['start', 'end'] as const) {
			const at = ends[which];
			if (
				Math.abs(point.x - at.x) <= HANDLE_REACH &&
				point.y >= at.top - HANDLE_REACH &&
				point.y <= at.top + at.height + HANDLE_REACH
			) {
				return which;
			}
		}

		return null;
	}

	function grabHandle(end: 'start' | 'end') {
		if (!selected || !viewer || !container) return;

		const ends = handleEnds();
		if (!ends) return;

		const { frame } = ends;
		const boxes = pdfRectsToClient(adjustRects, frame);
		const first = boxes[0];
		const last = boxes[boxes.length - 1];

		// A point inside the passage rather than exactly on its edge: on the edge
		// the caret lands between characters and often on nothing at all. Which
		// side it is nudged towards decides which character is included, so the
		// fixed end is nudged *inwards* and the answer is the boundary the reader
		// can see.
		const fixed =
			end === 'start'
				? toWindow({
						left: frame.bounds.left + last.left + last.width - 1,
						top: frame.bounds.top + last.top + last.height / 2
					})
				: toWindow({
						left: frame.bounds.left + first.left + 1,
						top: frame.bounds.top + first.top + first.height / 2
					});

		// Nothing selected while an end is being dragged, for the same reason as
		// above: a selection over the mark blends into it and takes its colour.
		window.getSelection()?.removeAllRanges();

		adjustAnchor = caretAtPoint(fixed);

		// Nothing under that point — a mark whose page has re-rendered under it,
		// or one drawn over a figure. Better not to start than to drag against an
		// anchor that is not there.
		dragging = adjustAnchor ? end : null;
	}

	/** Follow the pointer, previewing the new extent as it moves. */
	function onHandleDrag(at: { x: number; y: number }) {
		if (!selected || !dragging || !adjustAnchor || !container || !viewer) return;

		const moving = caretAtPoint(at);
		if (!moving) return;

		// Only somewhere in the paper counts. A drag that wanders into the marks
		// panel or the toolbar still lands on *something*, and a range spanning
		// from a passage into the chrome produces rectangles that are not on any
		// page — some of which would survive the filter below by overlapping it.
		if (!container.contains(moving.startContainer)) return;

		const range = rangeFrom(adjustAnchor, moving);
		if (!range) return;

		const frame = viewer.frameFor(selected.page);
		if (!frame) return;

		const bounds = container.getBoundingClientRect();
		const scroll = { left: container.scrollLeft, top: container.scrollTop };

		const inPdf = clientRectsToPdf(
			[...range.getClientRects()].map((rect) =>
				toContentSpace(
					{ left: rect.left, top: rect.top, width: rect.width, height: rect.height },
					bounds,
					scroll
				)
			),
			frame
		);

		// A drag that has wandered off the text — the margin, another page, the
		// gap between columns — leaves the mark where it was rather than
		// collapsing it to nothing.
		if (inPdf.length === 0) return;

		// Snapped as it moves, so the band the reader is dragging is the band they
		// will get. The cache is warmed when the mark is picked up; an unwarmed
		// page simply previews unsnapped for a moment.
		adjustRects = snapToLines(inPdf, lineCache.peek(selected.page) ?? []);
		adjustQuote = range.toString();
	}

	/** Keep what the handles ended up covering. */
	async function endAdjust() {
		const target = selected;
		const covered = adjustRects;
		dragging = null;

		if (!target || covered.length === 0) return;

		// The stored quote is only replaced when the drag actually found words;
		// a handle picked up and put straight down should change nothing.
		if (adjustQuote.trim() === (target.quote ?? '').trim()) return;

		await annotationsStore.update(
			target,
			{ ...(await anchorFor({ page: target.page, rects: covered, quote: adjustQuote })) },
			'what that mark covered'
		);

		// The mark stays in hand. Re-drawing it is usually two or three goes at
		// the same passage, and putting it down after each would mean picking it
		// up again to try the other end.
		//
		// Through `select`, and only if it is still held. Assigning `selected` on
		// its own left it pointing at a mark whose rectangles had been emptied by
		// a `deselect` that landed while the save was in flight — a selected mark
		// with nothing to draw, which is a mark that has vanished.
		if (!selected) return;

		const again = $annotationsStore.annotations.find((a) => a.id === target.id);
		if (again) select(again, { popup: popupAt !== null });
	}

	/**
	 * Put the last change back, and say what it was.
	 *
	 * The message is the point. An undo that changes something out of sight —
	 * a mark three pages up, a colour in a panel that is closed — is
	 * indistinguishable from one that did nothing at all.
	 */
	async function undoLast() {
		// Anything open is about a mark that may be about to change underneath it.
		chosen = null;
		editing = null;
		deselect();

		try {
			const undone = await annotationsStore.undo();
			if (undone) successToast(`Put back ${undone}.`);
		} catch (failure) {
			console.error('Could not undo that:', failure);
			errorToast('Could not undo that.');
		}
	}

	function rectsOf(mark: Annotation): Rect[] {
		try {
			const parsed = JSON.parse(mark.rects ?? '[]');
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	/**
	 * Look for marks somebody already made in this file.
	 *
	 * Offered rather than done. Highlights appearing in a paper unannounced is
	 * worse than being asked — they would read as Erti's own doing, and there
	 * would be no obvious way to tell them from marks the researcher made
	 * themselves or to get rid of them.
	 */
	async function lookForExisting(mine: number) {
		if (!viewer || !$annotationsStore.sha256) return;

		try {
			const already = new Set(
				$annotationsStore.annotations
					.filter((a) => a.origin === 'imported')
					.map((a) => importKeyOf(a))
			);

			const found = await collectImportable(
				$annotationsStore.sha256,
				viewer.pages,
				(page) => viewer!.pageAnnotations(page),
				(page) => viewer!.pageLines(page),
				$annotationsStore.labels,
				already
			);

			if (mine === generation) offered = found;
		} catch (failure) {
			console.error('Could not look for existing highlights:', failure);
		}
	}

	/** The key an already-imported mark would have had, to match against. */
	function importKeyOf(annotation: Annotation): string {
		let rects: Rect[] = [];
		try {
			const parsed = JSON.parse(annotation.rects ?? '[]');
			if (Array.isArray(parsed)) rects = parsed;
		} catch {
			rects = [];
		}
		return importKey(annotation.sha256, annotation.page, rects);
	}

	async function acceptImport() {
		if (importing) return;
		importing = true;

		try {
			for (const candidate of offered) {
				await annotationsStore.save({
					id: crypto.randomUUID(),
					sha256: $annotationsStore.sha256 ?? '',
					kind: candidate.quote ? 'highlight' : 'page-note',
					label_id: candidate.labelId,
					page: candidate.page,
					rects: JSON.stringify(candidate.rects),
					quote: candidate.quote || null,
					note: candidate.note,
					origin: 'imported'
				});
			}

			offered = [];
			sidebarTab = 'marks';
			sidebarOpen = true;
		} catch (failure) {
			console.error('Could not import those highlights:', failure);
			errorToast('Could not bring in those highlights.');
		} finally {
			importing = false;
		}
	}

	/** Where a pointer is, in the scrolling content's coordinates. */
	function pointIn(event: PointerEvent) {
		if (!container) return { x: 0, y: 0 };
		const bounds = container.getBoundingClientRect();
		return {
			x: event.clientX - bounds.left + container.scrollLeft,
			y: event.clientY - bounds.top + container.scrollTop
		};
	}

	/**
	 * Keep a figure, a table or an equation.
	 *
	 * The text layer cannot do this: a figure is pixels, and its caption is the
	 * only part of it that is text at all. Researchers want the picture — it goes
	 * in a talk, or beside their own results — so the region is cropped from the
	 * page as it is drawn and kept with the mark.
	 */
	async function snapshot(box: { left: number; top: number; width: number; height: number }) {
		if (!viewer || box.width < 8 || box.height < 8) return;

		const frames = nearbyFrames();
		const frame = frames.find(
			(candidate) =>
				box.left + box.width > candidate.bounds.left &&
				box.left < candidate.bounds.left + candidate.bounds.width &&
				box.top + box.height > candidate.bounds.top &&
				box.top < candidate.bounds.top + candidate.bounds.height
		);
		if (!frame) return;

		const rects = clientRectsToPdf([box], frame);
		if (rects.length === 0) return;

		const id = crypto.randomUUID();

		try {
			const png = await viewer.cropPage(frame.page, rects[0]);

			justMade = id;

			await annotationsStore.save(
				{
					id,
					sha256: $annotationsStore.sha256 ?? '',
					kind: 'area',
					label_id: $annotationsStore.lastLabel,
					page: frame.page,
					rects: JSON.stringify(rects),
					quote: null,
					note: null
				},
				'the picture you kept'
			);

			if (png) await saveAnnotationImage(id, Array.from(png));
		} catch (failure) {
			console.error('Could not keep that region:', failure);
			errorToast('Could not keep that region of the page.');
		}
	}

	/**
	 * Leave a note where the page was clicked.
	 *
	 * Zotero's note tool, and the one annotation that is about a place rather
	 * than about anything printed there — a question in a margin, a "compare with
	 * Ilves" beside a figure. The square is its anchor, so it is stored in PDF
	 * points and stays where it was put at any zoom.
	 */
	async function noteAt(point: { x: number; y: number }) {
		if (!viewer || !$annotationsStore.sha256) return;

		const frame = nearbyFrames().find(
			(candidate) =>
				point.x >= candidate.bounds.left &&
				point.x <= candidate.bounds.left + candidate.bounds.width &&
				point.y >= candidate.bounds.top &&
				point.y <= candidate.bounds.top + candidate.bounds.height
		);
		if (!frame) return;

		const rects = clientRectsToPdf(
			[{ left: point.x, top: point.y, width: NOTE_SIZE, height: NOTE_SIZE }],
			frame
		);
		if (rects.length === 0) return;

		const id = crypto.randomUUID();
		justMade = id;

		await annotationsStore.save(
			{
				id,
				sha256: $annotationsStore.sha256,
				kind: 'page-note',
				label_id: $annotationsStore.lastLabel,
				page: frame.page,
				page_label: labelsForPages?.[frame.page - 1] ?? null,
				rects: JSON.stringify(rects),
				quote: null,
				note: ''
			},
			'the note'
		);

		// Straight into writing it. A marker dropped on a page with nothing in it
		// is not a note, and making the reader find it again to say what they
		// meant is how empty notes accumulate.
		tool = null;
		const placed = $annotationsStore.annotations.find((a) => a.id === id);
		if (placed) select(placed);
	}

	/**
	 * Scroll to a mark and say which one it was.
	 *
	 * The flash matters more than it looks: several marks can sit within a line
	 * of each other, and arriving at the right page without knowing which band of
	 * colour was meant leaves the reader to guess.
	 */
	function showMark(annotation: Annotation) {
		if (!viewer) return;

		let rects: Rect[] = [];
		try {
			const parsed = JSON.parse(annotation.rects ?? '[]');
			if (Array.isArray(parsed)) rects = parsed;
		} catch {
			rects = [];
		}

		viewer.goTo({ page: annotation.page, rects });

		flashing = annotation.id;
		setTimeout(() => {
			if (flashing === annotation.id) flashing = null;
		}, 3000);
	}

	function base64ToUint8Array(base64String: string) {
		const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
		const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
		const rawData = window.atob(base64);
		const outputArray = new Uint8Array(rawData.length);
		for (let i = 0; i < rawData.length; ++i) {
			outputArray[i] = rawData.charCodeAt(i);
		}
		return outputArray;
	}
</script>

<div class="bg-surface-sunken flex h-full w-full flex-col">
	{#if error}
		<div class="error">{error}</div>
	{:else}
		<PdfToolbar
			{page}
			{pages}
			{pageLabel}
			{scale}
			find={findState}
			{searching}
			onpage={(next) => viewer?.goToPage(next)}
			ongoto={goToValue}
			onzoom={(factor) => viewer?.zoomBy(factor)}
			onfit={() => viewer?.setZoom('page-width')}
			onsearch={(query, options) => viewer?.find(query, options)}
			onclosesearch={() => {
				searching = false;
				viewer?.clearFind();
			}}
			ontogglesearch={() => (searching = true)}
			canGoBack={history.length > 0}
			onback={goBack}
			marks={$annotationsStore.annotations.length}
			{sidebarOpen}
			ontogglesidebar={() => (sidebarOpen = !sidebarOpen)}
			onshowmarks={() => {
				sidebarTab = 'marks';
				sidebarOpen = true;
			}}
			{tool}
			ontool={(next) => {
				tool = next;
				deselect();
			}}
			labels={$annotationsStore.labels}
			lastLabel={$annotationsStore.lastLabel}
			onlabel={(labelId) => annotationsStore.chooseLabel(labelId)}
			onrename={(label, name) => void annotationsStore.rename(label, name)}
			onresetnames={() => void annotationsStore.useColourNames()}
			{scrollMode}
			{spreadMode}
			{rotation}
			{pageTheme}
			onscrollmode={(mode) => {
				scrollMode = mode;
				viewer?.setScrollMode(mode);
			}}
			onspreadmode={(mode) => {
				spreadMode = mode;
				viewer?.setSpreadMode(mode);
			}}
			onrotate={(degrees) => {
				viewer?.rotateBy(degrees);
				rotation = viewer?.rotation ?? 0;
			}}
			onpagetheme={(theme) => (pageTheme = theme)}
		/>

		{#if offered.length > 0}
			<!--
				Said plainly, and never done on its own. Highlights appearing in a
				paper unannounced would read as Erti's own doing, with no way to tell
				them from your own or to undo them.
			-->
			<div
				class="border-line bg-surface-sunken text-ink flex items-center gap-3 border-b px-3 py-2 text-xs"
				role="status"
			>
				<span>
					This paper already carries {offered.length}
					{offered.length === 1 ? 'highlight' : 'highlights'} made in another tool.
				</span>

				<button
					class="bg-accent text-accent-ink hover:bg-accent-hover rounded px-2 py-1 font-medium disabled:opacity-60"
					disabled={importing}
					onclick={() => void acceptImport()}
				>
					{importing ? 'Bringing them in…' : 'Bring them in'}
				</button>

				<button class="text-ink-muted hover:text-ink" onclick={() => (offered = [])}>
					Not now
				</button>
			</div>
		{/if}

		<div class="flex min-h-0 grow">
			{#if sidebarOpen}
				<ReaderSidebar
					tab={sidebarTab}
					ontab={(next) => (sidebarTab = next)}
					{pages}
					{page}
					pageLabels={labelsForPages}
					outline={contents}
					thumbnail={(n, width) => viewer?.thumbnail(n, width) ?? Promise.resolve(null)}
					revision={document_}
					onpage={(n) => {
						rememberPlace();
						viewer?.goToPage(n);
					}}
					onoutline={(dest) => {
						rememberPlace();
						viewer?.goToOutline(dest);
					}}
					annotations={$annotationsStore.annotations}
					labels={$annotationsStore.labels}
					reveal={justMade}
					onjump={(annotation) => showMark(annotation)}
					ondelete={(id) => void annotationsStore.remove(id, 'that deletion')}
					onnote={(annotation, note) =>
						void annotationsStore.update(annotation, { note }, 'that note')}
					onlabel={(annotation, labelId) =>
						void annotationsStore.update(annotation, { label_id: labelId }, 'that colour')}
				/>
			{/if}

			<div class="relative min-h-0 grow">
				<!--
				pdf.js requires the scrolling container to be absolutely positioned
				and computes page layout against it, so this cannot be a plain flex
				child. The inner div is the one it fills with pages.
			-->
				<!--
				Focusable, and named. A region that scrolls but cannot be reached
				without a pointer is unusable by keyboard, and this one holds the
				paper — so it takes a tab stop and says what it is. The rule below
				cannot tell that this div scrolls, and reads a tab stop on a plain
				element as a mistake; here it is the accessible choice.
			-->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div
					bind:this={container}
					class="erti-pages focus-inset absolute inset-0 overflow-auto"
					class:erti-picking={tool === 'area' || tool === 'note'}
					class:erti-adjusting={dragging !== null}
					data-page-theme={pageTheme}
					role="region"
					aria-label="Paper"
					tabindex="0"
				>
					<div class="pdfViewer"></div>

					{#if dragBox}
						<div
							class="border-accent pointer-events-none absolute border-2"
							style:left="{dragBox.left}px"
							style:top="{dragBox.top}px"
							style:width="{dragBox.width}px"
							style:height="{dragBox.height}px"
							style:background="hsl(var(--accent) / 0.12)"
							aria-hidden="true"
						></div>
					{/if}

					<HighlightLayer
						annotations={$annotationsStore.annotations}
						labels={$annotationsStore.labels}
						frameFor={(n) => viewer?.frameFor(n) ?? null}
						revision={layout}
						{flashing}
						override={selected ? { id: selected.id, rects: adjustRects } : null}
						outlined={selected?.id ?? null}
						hovered={selected ? null : hovering}
						onselect={(annotation) => {
							chosen = null;
							select(annotation);
						}}
						oncontext={(annotation, at) => {
							select(annotation, { popup: false });
							chosen = { mark: annotation, at: pointerBox(at) };
						}}
					/>

					{#if selected && selected.kind === 'highlight' && adjustFrame}
						<!--
							Live from the moment the mark is picked up. No mode, no
							banner, nothing to dismiss — which is what made re-drawing a
							mark need Escape to get out of.
						-->
						<AdjustHandles rects={adjustRects} frame={adjustFrame} {dragging} />
					{/if}

					{#if editing}
						{@const box = markBox(editing.mark)}
						{#if box}
							<FieldEditor
								mark={editing.mark}
								at={box}
								onsave={(value) =>
									void annotationsStore.update(
										editing!.mark,
										// Empty means "the same as the sheet", which is right for
										// most PDFs and is not worth storing.
										{ page_label: value || null },
										'that page number'
									)}
								onclose={() => (editing = null)}
							/>
						{/if}
					{/if}

					{#if selected && popupAt}
						<AnnotationPopup
							mark={selected}
							at={popupAt}
							colour={colourFor($annotationsStore.labels, selected.label_id)}
							page={pageLabelOf(selected)}
							onsave={(note) => void annotationsStore.update(selected!, { note }, 'that note')}
							onmenu={(at) => (chosen = { mark: selected!, at: pointerBox(at) })}
							onpagelabel={() => (editing = { mark: selected! })}
							onclose={deselect}
						/>
					{/if}

					{#if chosen}
						<MarkMenu
							mark={chosen.mark}
							at={chosen.at}
							labels={$annotationsStore.labels}
							onlabel={(labelId) => {
								void annotationsStore.update(chosen!.mark, { label_id: labelId }, 'that colour');
								chosen = null;
							}}
							onconvert={() => {
								void annotationsStore.update(
									chosen!.mark,
									{ style: chosen!.mark.style === 'underline' ? 'fill' : 'underline' },
									'that change'
								);
								chosen = null;
							}}
							onpagelabel={() => {
								editing = { mark: chosen!.mark };
								chosen = null;
							}}
							oncopyimage={() => {
								void copyImage(chosen!.mark);
								chosen = null;
							}}
							onsaveimage={() => {
								void saveImage(chosen!.mark);
								chosen = null;
							}}
							ondelete={() => {
								void annotationsStore.remove(chosen!.mark.id, 'that deletion');
								chosen = null;
							}}
							onclose={() => (chosen = null)}
						/>
					{/if}

					{#if selecting}
						<SelectionMenu
							at={selecting.focus}
							preferAbove={selecting.focus.top - (container?.scrollTop ?? 0) > 120}
							labels={$annotationsStore.labels}
							lastLabel={$annotationsStore.lastLabel}
							markStyle={pendingStyle}
							onstyle={(style) => (pendingStyle = style)}
							onhighlight={(labelId) => void mark(labelId, false)}
							onnote={(labelId) => void mark(labelId, true)}
							oncopy={() => {
								void navigator.clipboard.writeText(selecting?.quote ?? '');
								selecting = null;
							}}
							onclose={() => {
								selecting = null;
								window.getSelection()?.removeAllRanges();
							}}
						/>
					{/if}
				</div>

				{#if loading}
					<div class="text-ink-muted absolute inset-0 flex items-center justify-center text-xs">
						Loading PDF…
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.error {
		padding: 1rem;
		text-align: center;
		color: hsl(var(--danger));
	}

	/*
	  The page's own colour, which the rest of the application does not control.

	  Every other surface follows the chosen palette; a PDF is the one that stays
	  stark white in a dark room, and reading papers at night is a real complaint
	  rather than a styling preference. Applied to what pdf.js paints rather than
	  to the container, so highlights, handles and popups keep the palette's own
	  colours and stay legible against the tinted page.

	  Inverting hue as well as luminance is what keeps a figure recognisable: a
	  plain `invert(1)` turns a red line blue, which in a paper about results is
	  not a cosmetic difference.
	*/
	.erti-pages :global(canvas) {
		transition: filter 120ms ease;
	}

	.erti-pages[data-page-theme='sepia'] :global(canvas) {
		filter: sepia(0.42) saturate(0.9) brightness(0.97);
	}

	.erti-pages[data-page-theme='dark'] :global(canvas) {
		filter: invert(0.92) hue-rotate(180deg) brightness(1.05) contrast(0.92);
	}

	.erti-pages[data-page-theme='dark'] {
		background: hsl(220 16% 14%);
	}

	.erti-pages[data-page-theme='sepia'] {
		background: hsl(40 32% 82%);
	}

	/*
	  A crosshair says the next click puts something on the page rather than
	  selecting words, which is the only cue that these two tools are in hand.
	*/
	.erti-picking {
		cursor: crosshair;
	}

	.erti-picking :global(.textLayer) {
		user-select: none;
	}

	/*
	  Nothing selects while an end is being dragged. The drag is already asking
	  the document what is under the pointer; letting the webview start its own
	  selection at the same time gives two answers to one gesture.
	*/
	.erti-adjusting {
		user-select: none;
		cursor: col-resize;
	}
</style>
