<script lang="ts">
	import { pdfRectsToClient, type PageFrame, type Rect } from './location';

	/**
	 * Two carets, at the ends of a mark, to say where it should really start and
	 * stop.
	 *
	 * Dragging the ends of the thing itself is how selections have worked on every
	 * touch device for fifteen years, and it answers "extend or shorten" without
	 * either word appearing. The alternative — a button that says "now select it
	 * again" — makes the reader redo work they have already done.
	 *
	 * The caret blinks for the same reason a text cursor does: it says this is the
	 * live end of something, not a decoration drawn on the page. The knob above it
	 * is what makes it catchable — a two-pixel bar is not a target, and the first
	 * version of this was one.
	 *
	 * **Nothing here takes a pointer.** Following the pointer from an element that
	 * is under the pointer would mean asking the document which character is
	 * there and being told "the handle" — so the reader hit-tests these two
	 * positions itself, from the same rectangles it draws them from, exactly as
	 * it does for the marks. They stay buttons so they are named and reachable;
	 * they are simply never what a press lands on.
	 */
	interface Props {
		rects: Rect[];
		frame: PageFrame;
		/** Which end is being dragged, so it can stop blinking while it moves. */
		dragging: 'start' | 'end' | null;
	}

	const { rects, frame, dragging }: Props = $props();

	/**
	 * Where the ends are, in the scrolling content's coordinates.
	 *
	 * Reading order, not geometry: the first rectangle is the first line of the
	 * passage and the last is its final line, so the start caret goes to the left
	 * of the first and the end caret to the right of the last. `mergeRects`
	 * already returns them top-down and left-to-right.
	 */
	const ends = $derived.by(() => {
		if (rects.length === 0) return null;

		const boxes = pdfRectsToClient(rects, frame);
		const first = boxes[0];
		const last = boxes[boxes.length - 1];

		return {
			start: {
				left: frame.bounds.left + first.left,
				top: frame.bounds.top + first.top,
				height: first.height
			},
			end: {
				left: frame.bounds.left + last.left + last.width,
				top: frame.bounds.top + last.top,
				height: last.height
			}
		};
	});
</script>

{#if ends}
	{#each [{ which: 'start' as const, box: ends.start }, { which: 'end' as const, box: ends.end }] as handle (handle.which)}
		<button
			type="button"
			class="erti-handle"
			class:erti-handle-dragging={dragging !== null}
			class:erti-handle-start={handle.which === 'start'}
			style:left="{handle.box.left}px"
			style:top="{handle.box.top}px"
			style:height="{handle.box.height}px"
			aria-label={handle.which === 'start'
				? 'Drag to move where this mark starts'
				: 'Drag to move where this mark ends'}
		></button>
	{/each}
{/if}

<style>
	.erti-handle {
		position: absolute;
		width: 2px;
		padding: 0;
		border: 0;
		background: hsl(var(--accent));
		/*
		  Never a pointer target, and never part of a selection. The reader
		  hit-tests these two positions from the geometry instead; an element in
		  the way of the words is what made both this gesture and plain text
		  selection unreliable.
		*/
		pointer-events: none;
		user-select: none;
		z-index: 25;
		animation: erti-handle-blink 1.1s step-end infinite;
	}

	/*
	  The knob. A blinking two-pixel bar says where the end is; this is what the
	  hand actually catches, and putting it outside the passage — above the start,
	  below the end — keeps it off the words it is there to move.
	*/
	.erti-handle::before {
		content: '';
		position: absolute;
		left: 50%;
		width: 9px;
		height: 9px;
		margin-left: -4.5px;
		border-radius: 50%;
		background: hsl(var(--accent));
		box-shadow: 0 0 0 1.5px hsl(var(--surface-overlay));
	}

	.erti-handle-start::before {
		top: -7px;
	}

	.erti-handle:not(.erti-handle-start)::before {
		bottom: -7px;
	}

	/*
	  A wider invisible target around all of it. Without it the handle is
	  unhittable with a trackpad, which would make the whole gesture theoretical.
	*/
	.erti-handle::after {
		content: '';
		position: absolute;
		inset: -10px -12px;
	}

	/* Still while it is being moved: a caret that blinks under the hand reads as
	   a redraw rather than as the thing being dragged. */
	.erti-handle-dragging {
		animation: none;
	}

	.erti-handle:focus-visible {
		outline: 2px solid hsl(var(--accent));
		outline-offset: 3px;
		animation: none;
	}

	@keyframes erti-handle-blink {
		0%,
		49% {
			opacity: 1;
		}
		50%,
		100% {
			opacity: 0.3;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.erti-handle {
			animation: none;
		}
	}
</style>
