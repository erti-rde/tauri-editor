<script context="module" lang="ts">
	export type PdfAction = 'previous-page' | 'next-page' | 'zoom-in' | 'zoom-out';
</script>

<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	import { Icon } from '$lib';
	const dispatch = createEventDispatcher();
	function dispatchAction(action: PdfAction) {
		dispatch('pdfAction', { action });
	}
</script>

<div class="flex w-full bg-orange-100">
	<div class="mr-1 py-1 hover:bg-orange-200">
		<button class="p-1" on:click={() => dispatchAction('previous-page')}>
			<Icon icon="ChevronLeft" size="s" />
		</button>
	</div>
	<div class="mr-1 py-1 hover:bg-orange-200">
		<button class="p-1" on:click={() => dispatchAction('next-page')}>
			<Icon icon="ChevronRight" size="s" />
		</button>
	</div>
	<div class="mr-1 py-1 hover:bg-orange-200">
		<button class="p-1" on:click={() => dispatchAction('zoom-in')}>
			<Icon icon="ZoomIn" size="s" />
		</button>
	</div>
	<div class="mr-1 py-1 hover:bg-orange-200">
		<button class="p-1" on:click={() => dispatchAction('zoom-out')}>
			<Icon icon="ZoomOut" size="s" />
		</button>
	</div>
</div>
