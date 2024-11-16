<script lang="ts">
	import { Icon } from '$lib';
	import { createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher();

	function toggleExplorer() {
		dispatch('toggleExplorer');
	}
</script>

<div class="flex w-full justify-center">
	<button
		class="p-2"
		on:click={() => {
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
