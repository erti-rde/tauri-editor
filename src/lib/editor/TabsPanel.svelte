<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { Icon } from '$lib';

	export let mode = 'editor';

	const dispatch = createEventDispatcher();

	function switchMode() {
		mode = mode === 'editor' ? 'preview' : 'editor';
		dispatch('switch', { mode });
	}

	function handleExport() {
		dispatch('export');
	}
</script>

<div class="flex w-full justify-end bg-orange-100">
	<div class="mr-1 py-1 hover:bg-orange-200">
		<button class="p-1" on:click={switchMode}>
			{#if mode === 'editor'}
				<Icon icon="BookOpen" size="s" />
			{:else}
				<Icon icon="FilePen" size="s" />
			{/if}
		</button>
	</div>
	<div class="mr-1 py-1 hover:bg-orange-200">
		<button class="p-1" on:click={handleExport}>
			<Icon icon="FileOutput" size="s" />
		</button>
	</div>
</div>
