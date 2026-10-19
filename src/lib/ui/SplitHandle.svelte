<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import GripVertical from '~icons/lucide/grip-vertical';

	/**
	 * The line between two panes side by side, which moves (M5-9).
	 *
	 * Dragged with the pointer, or focused and moved with the arrow keys: left
	 * and right by `step`, Home and End to the limits. A double-click puts it
	 * back at `reset`. A 1px rule at rest, as the fixed divide was; the grip
	 * shows on hover and focus, so the line looks like something that moves only
	 * when it's about to be.
	 *
	 * `value` is the first pane's share of the width, from 0 to 1, and is said
	 * as a percentage (`role="separator"` with a value is the focusable kind, the
	 * one a screen reader offers to move). The handle sits between its two panes
	 * in a flex row and measures that row, so the caller only lays the panes out
	 * by the share.
	 */
	interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'onchange'> {
		/** What it resizes: "Resize the split". */
		label: string;
		value: number;
		/** The least share the first pane may have; the caller works it out from a width. */
		min?: number;
		/** The most. */
		max?: number;
		/** For each arrow key press. */
		step?: number;
		/** Where a double-click puts it. */
		reset?: number;
		/** The share was chosen: a drag let go, a key, a double-click. Not called mid-drag. */
		onchange?: (value: number) => void;
	}

	let {
		label,
		value = $bindable(),
		min = 0,
		max = 1,
		step = 0.02,
		reset = 0.5,
		onchange,
		class: extra,
		...rest
	}: Props = $props();

	let dragging = $state(false);
	/**
	 * The share when the drag began, to tell a drag from a click. As kept, not
	 * as drawn: a click on a share from a wider window chooses nothing.
	 */
	let from = 0;

	const clamp = (n: number) => Math.min(max, Math.max(min, n));
	const percent = (n: number) => Math.round(n * 100);
	/** Where it's drawn: a share kept from a wider window may be past today's limits. */
	const shown = $derived(clamp(value));

	function set(next: number) {
		value = clamp(next);
	}

	function choose(next: number) {
		const chosen = clamp(next);
		// Nothing moved, so nothing's chosen: a share kept from a wider window,
		// drawn at today's limit, stays kept for when the window is wide again.
		if (chosen === shown) return;
		value = chosen;
		onchange?.(chosen);
	}

	/** The share under the pointer, measured across the row the handle divides. */
	function shareAt(handle: HTMLElement, x: number) {
		const row = handle.parentElement?.getBoundingClientRect();
		if (!row || row.width <= 0) return shown;
		const own = handle.getBoundingClientRect().width;
		// The handle takes its own width out of the row, so the panes share the rest.
		return (x - row.left - own / 2) / Math.max(1, row.width - own);
	}

	function pointerdown(event: PointerEvent & { currentTarget: HTMLDivElement }) {
		if (event.button !== 0) return;
		// No text selected in either pane on the way across.
		event.preventDefault();
		event.currentTarget.focus();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		dragging = true;
		from = value;
	}

	function pointermove(event: PointerEvent & { currentTarget: HTMLDivElement }) {
		if (!dragging) return;
		set(shareAt(event.currentTarget, event.clientX));
	}

	function pointerup(event: PointerEvent & { currentTarget: HTMLDivElement }) {
		if (!dragging) return;
		dragging = false;
		event.currentTarget.releasePointerCapture?.(event.pointerId);
		if (value !== from) onchange?.(value);
	}

	function keydown(event: KeyboardEvent) {
		const next =
			event.key === 'ArrowLeft'
				? shown - step
				: event.key === 'ArrowRight'
					? shown + step
					: event.key === 'Home'
						? min
						: event.key === 'End'
							? max
							: null;
		if (next === null) return;
		event.preventDefault();
		choose(next);
	}
</script>

<!-- Focusable: a separator with a value is a widget (WAI-ARIA), moved with
     the arrow keys. Svelte counts every separator as static. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	role="separator"
	aria-orientation="vertical"
	aria-label={label}
	aria-valuenow={percent(shown)}
	aria-valuemin={percent(min)}
	aria-valuemax={percent(max)}
	aria-valuetext="{percent(shown)}% of the width on the left"
	tabindex="0"
	data-dragging={dragging || undefined}
	class={[
		'group focus-inset relative flex w-2 shrink-0 cursor-col-resize touch-none justify-center',
		'before:bg-line data-dragging:before:bg-line-strong before:w-px before:content-[""]',
		extra
	]}
	onpointerdown={pointerdown}
	onpointermove={pointermove}
	onpointerup={pointerup}
	onpointercancel={pointerup}
	onkeydown={keydown}
	ondblclick={() => choose(reset)}
	{...rest}
>
	<span
		class="bg-surface border-line-strong text-ink-muted pointer-events-none absolute top-1/2 left-1/2 grid h-7 w-2.5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded border opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-dragging:opacity-100"
		aria-hidden="true"
	>
		<GripVertical class="size-3" />
	</span>
</div>
