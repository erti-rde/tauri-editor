<script lang="ts">
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import Minus from '~icons/lucide/minus';
	import Plus from '~icons/lucide/plus';

	import { ZOOM_MAX, ZOOM_MIN, formatZoom, zoomStore } from './zoom';

	/**
	 * How large the page is drawn.
	 *
	 * Sits at the far left of the toolbar, where every editor that has one puts
	 * it, because it is a property of the view rather than of the selection.
	 */

	const atMin = $derived($zoomStore <= ZOOM_MIN + 0.001);
	const atMax = $derived($zoomStore >= ZOOM_MAX - 0.001);

	const step =
		'text-ink-muted hover:bg-surface-hover hover:text-ink rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40';
</script>

<div class="flex shrink-0 items-center gap-0.5">
	<Tooltip label="Zoom out" side="bottom">
		{#snippet children(tooltip)}
			<button {...tooltip} class={step} disabled={atMin} onclick={() => zoomStore.out($zoomStore)}>
				<Minus class="h-3.5 w-3.5" />
			</button>
		{/snippet}
	</Tooltip>

	<Tooltip label="Reset zoom to 100%" side="bottom">
		{#snippet children(tooltip)}
			<button
				{...tooltip}
				class="text-ink-muted hover:bg-surface-hover hover:text-ink min-w-[3.25rem] rounded px-1 py-1 font-mono text-[11px] tabular-nums transition-colors"
				onclick={() => zoomStore.reset()}
			>
				{formatZoom($zoomStore)}
			</button>
		{/snippet}
	</Tooltip>

	<Tooltip label="Zoom in" side="bottom">
		{#snippet children(tooltip)}
			<button {...tooltip} class={step} disabled={atMax} onclick={() => zoomStore.in($zoomStore)}>
				<Plus class="h-3.5 w-3.5" />
			</button>
		{/snippet}
	</Tooltip>
</div>
