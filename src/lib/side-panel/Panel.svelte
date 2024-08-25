<script lang="ts">
	import { Icon } from '$lib';
	import { createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher();

	let current = 'Files';

	function toggleExplorer() {
		dispatch('toggleExplorer');
	}
</script>

<div class="flex w-full justify-center">
	<button
		class="p-2"
		on:click={() => {
			current = 'Files';
			toggleExplorer();
		}}
	>
		<Icon icon="Files" />
	</button>
</div>

<style>
	button:hover {
		background-color: var(--hover-color);
	}
</style>
