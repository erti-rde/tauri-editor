<script lang="ts">
	import { pdfRectsToClient, type PageFrame, type Rect } from './location';

	import type { Annotation, AnnotationLabel } from '$lib/stores/db';
	import { colourFor } from '$lib/stores/annotations.svelte';

	/**
	 * The marks, drawn over the pages.
	 *
	 * One layer for the whole document rather than one per page. pdf.js destroys
	 * and rebuilds a page's contents on every zoom change and whenever a page
	 * scrolls far enough out of view, so anything mounted inside a page has to be
	 * put back afterwards — and a highlight that disappears when you zoom is
	 * worse than one that was never drawn.
	 *
	 * Positioned in the scrolling container's content coordinates, so the marks
	 * scroll with the pages without being children of them.
	 *
	 * **Nothing here takes a pointer.** A mark is drawn over the words it marks,
	 * and an element over the words is an element in the way of them: dragging a
	 * selection across a highlight hit-tested onto the highlight instead of the
	 * text, and because these sit beside `.pdfViewer` rather than inside a page,
	 * the browser resolved that by selecting their common ancestor — the whole
	 * document. That is the runaway "it selected the entire page" and it is the
	 * same fault that stopped a mark's ends being dragged.
	 *
	 * So the reader hit-tests instead, against the rectangles it already stores,
	 * and tells this layer what is under the pointer. Keyboard activation still
	 * works through these buttons, because Enter dispatches `click` to a focused
	 * element whether or not it can be pointed at.
	 */
	interface Props {
		annotations: Annotation[];
		labels: AnnotationLabel[];
		/** Where each page currently sits. Null for a page not laid out yet. */
		frameFor: (page: number) => PageFrame | null;
		/** Bumped by the reader whenever the pages move, to force a re-measure. */
		revision: number;
		/** Briefly ringed after a jump, so the reader can see where they landed. */
		flashing?: string | null;
		/**
		 * One mark drawn somewhere other than where it is stored.
		 *
		 * What makes dragging the ends of a mark legible: the band moves with the
		 * handles as they move, instead of staying where the passage used to be
		 * while two carets wander off across the page.
		 */
		override?: { id: string; rects: Rect[] } | null;
		/** The mark under the pointer, as the reader worked it out. */
		hovered?: string | null;
		/**
		 * The mark the reader has picked up, drawn with a dashed outline.
		 *
		 * The outline is what says a mark is in hand and that its ends can be
		 * dragged — the same thing Zotero draws, and the reason neither reader
		 * needs a banner explaining that a mode has been entered.
		 */
		outlined?: string | null;
		/** Left click: the note written on this passage. */
		onselect?: (annotation: Annotation) => void;
		/** Right click: everything else that can be done to it. */
		oncontext?: (annotation: Annotation, at: { x: number; y: number }) => void;
	}

	const {
		annotations,
		labels,
		frameFor,
		revision,
		flashing,
		override = null,
		hovered = null,
		outlined = null,
		onselect,
		oncontext
	}: Props = $props();

	interface Drawn {
		id: string;
		/** The annotation this rectangle belongs to, so every band of one mark lights together. */
		own: string;
		colour: string;
		underline: boolean;
		/** A note left on the page rather than on any words: a marker, not a band. */
		pin: boolean;
		/**
		 * The last band of a mark that carries a note.
		 *
		 * Only the last, because the marker belongs to the mark and not to each
		 * line of it — three corner tabs down a wrapped passage would read as
		 * three notes.
		 */
		annotated: boolean;
		note: string | null;
		left: number;
		top: number;
		width: number;
		height: number;
		label: string;
		flash: boolean;
	}

	function parseRects(json: string | null): Rect[] {
		if (!json) return [];
		try {
			const parsed = JSON.parse(json);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			// A malformed anchor should cost that one mark, not the whole layer.
			return [];
		}
	}

	const drawn = $derived.by(() => {
		// Read so the marks are re-measured when the pages move; the value itself
		// is not used.
		void revision;

		const out: Drawn[] = [];

		for (const annotation of annotations) {
			// An override is a preview, so an empty one falls back to what is stored
			// rather than erasing the mark. The two came apart once — a mark put
			// down while its save was in flight kept its selection and lost its
			// rectangles — and the mark simply disappeared until it was clicked
			// away from.
			const preview = override && override.id === annotation.id ? override.rects : null;
			const rects = preview?.length ? preview : parseRects(annotation.rects);
			if (rects.length === 0) continue;

			const frame = frameFor(annotation.page);
			if (!frame) continue;

			const colour = colourFor(labels, annotation.label_id);
			const label = labels.find((l) => l.id === annotation.label_id)?.name ?? 'Highlight';

			const boxes = pdfRectsToClient(rects, frame);

			for (const [index, box] of boxes.entries()) {
				out.push({
					id: `${annotation.id}:${index}`,
					own: annotation.id,
					colour,
					underline: annotation.kind === 'highlight' && annotation.style === 'underline',
					pin: annotation.kind === 'page-note',
					annotated:
						annotation.kind !== 'page-note' &&
						!!annotation.note?.trim() &&
						index === boxes.length - 1,
					note: annotation.note,
					left: frame.bounds.left + box.left,
					top: frame.bounds.top + box.top,
					width: box.width,
					height: box.height,
					label,
					flash: flashing === annotation.id
				});
			}
		}

		return out;
	});

	function annotationOf(id: string): Annotation | undefined {
		const own = id.split(':')[0];
		return annotations.find((a) => a.id === own);
	}
</script>

{#each drawn as mark (mark.id)}
	<!--
		A button rather than a div: a mark is the way back to the note written on
		it, and reaching it should not require a mouse. It is unreachable *by*
		mouse from here — see the note above — so the click handler is the keyboard
		path only, and the pointer is served by the reader's own hit test.
	-->
	<button
		type="button"
		class="erti-mark"
		class:erti-mark-underline={mark.underline}
		class:erti-mark-pin={mark.pin}
		class:erti-mark-flash={mark.flash}
		class:erti-mark-hover={hovered === mark.own}
		class:erti-mark-picked={outlined === mark.own}
		class:erti-mark-annotated={mark.annotated}
		style:left="{mark.left}px"
		style:top="{mark.top}px"
		style:width="{mark.width}px"
		style:height="{mark.height}px"
		style:--mark-colour={mark.colour}
		aria-label="{mark.label}: {mark.note ? 'edit the note' : 'add a note'}"
		onclick={() => {
			const found = annotationOf(mark.id);
			if (found) onselect?.(found);
		}}
		oncontextmenu={(event) => {
			// Reachable from the keyboard's own menu key, which targets the focused
			// element directly. A pointer never gets here.
			event.preventDefault();
			const found = annotationOf(mark.id);
			if (found) oncontext?.(found, { x: event.clientX, y: event.clientY });
		}}
	></button>
{/each}

<style>
	.erti-mark {
		position: absolute;
		padding: 0;
		border: 0;
		border-radius: 1px;
		/*
		  Never a pointer target, and never part of a selection.

		  Both matter. Taking the pointer put this element in the way of the words
		  it marks; being selectable let a drag that crossed it pull in the common
		  ancestor of the whole viewer. The reader hit-tests the stored rectangles
		  instead, which is the same answer without an element in the way.
		*/
		pointer-events: none;
		user-select: none;
		/*
		  Multiply keeps the words underneath readable. A plain translucent fill
		  over the canvas washes the glyphs towards the highlight colour, which at
		  the alpha needed to be visible makes small type grey and hard to read —
		  the opposite of what marking a passage is for.
		*/
		mix-blend-mode: multiply;
		background: hsl(var(--mark-colour) / 0.45);
		transition: background 120ms ease;
	}

	/* Driven by the reader's hit test, since `:hover` cannot fire on this. */
	.erti-mark-hover {
		background: hsl(var(--mark-colour) / 0.65);
	}

	/*
	  The same passage, marked more lightly. Drawn as a border on a transparent
	  box rather than as a shorter filled one, so the whole passage still takes
	  the click — an underline you had to hit a two-pixel line to select would be
	  unreachable with a mouse and impossible with a trackpad.
	*/
	.erti-mark-underline {
		background: transparent;
		mix-blend-mode: normal;
		border-bottom: 2px solid hsl(var(--mark-colour));
		border-radius: 0;
	}

	.erti-mark-underline.erti-mark-hover {
		background: hsl(var(--mark-colour) / 0.2);
	}

	/*
	  A note left on the page, not on any words: a small solid marker with a fold,
	  the shape Zotero uses for the same thing. Drawn opaque rather than blended,
	  because there is nothing underneath it to keep readable.
	*/
	.erti-mark-pin {
		mix-blend-mode: normal;
		background: hsl(var(--mark-colour));
		border-radius: 2px;
		box-shadow:
			0 1px 2px hsl(0 0% 0% / 0.25),
			inset 0 0 0 1px hsl(0 0% 0% / 0.12);
		clip-path: polygon(0 0, 100% 0, 100% 68%, 68% 100%, 0 100%);
	}

	.erti-mark-pin.erti-mark-hover {
		background: hsl(var(--mark-colour));
		filter: brightness(1.08);
	}

	/*
	  Picked up: a dashed outline around every band of the mark.

	  Drawn outside the fill rather than as a border, so it does not change what
	  the mark covers as it appears — a highlight that grew by two pixels when
	  clicked would look like the click had edited it.
	*/
	.erti-mark-picked {
		outline: 1px dashed hsl(var(--accent));
		outline-offset: 1px;
	}

	/*
	  A mark you have written something on.
	  
	  Marking a passage and saying what you make of it are different acts, and a
	  band of colour cannot tell them apart — so a mark carrying a note gets a
	  folded corner. It is the one thing that distinguishes "I noticed this" from
	  "I have an argument about this", and until now nothing on the page did.
	*/
	.erti-mark-annotated::after {
		content: '';
		position: absolute;
		right: -1px;
		top: -3px;
		width: 0;
		height: 0;
		/* A small triangle in the mark's own colour, darkened so it reads against
		   the band it sits on. */
		border-top: 7px solid hsl(var(--mark-colour) / 0.95);
		border-left: 7px solid transparent;
		filter: brightness(0.72);
	}

	.erti-mark:focus-visible {
		outline: 2px solid hsl(var(--accent));
		outline-offset: 1px;
	}

	/*
	  A dark page needs the opposite blend.

	  `multiply` darkens, which is what keeps a highlight readable on white paper
	  and what makes it disappear on black — a dark fill over a dark page is a
	  dark page. `screen` lightens, so the mark shows for the same reason it did
	  before.
	*/
	:global([data-page-theme='dark']) .erti-mark:not(.erti-mark-underline):not(.erti-mark-pin) {
		mix-blend-mode: screen;
	}

	/* Shown after a jump, so the passage announces itself and then stops. */
	.erti-mark-flash {
		animation: erti-mark-flash 1.4s ease-out 2;
	}

	@keyframes erti-mark-flash {
		0%,
		100% {
			background: hsl(var(--mark-colour) / 0.45);
		}
		50% {
			background: hsl(var(--mark-colour) / 0.95);
		}
	}

	/* An underline has no fill to pulse, so it thickens instead. */
	.erti-mark-underline.erti-mark-flash {
		animation: erti-underline-flash 1.4s ease-out 2;
	}

	@keyframes erti-underline-flash {
		0%,
		100% {
			border-bottom-width: 2px;
		}
		50% {
			border-bottom-width: 5px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.erti-mark-flash {
			animation: none;
			outline: 2px solid hsl(var(--accent));
		}
	}
</style>
