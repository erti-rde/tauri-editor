<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { Icon } from '$lib';


	const dispatch = createEventDispatcher();

	function toggleSidePanel(panelName: string) {
		dispatch('toggleSidePanel', {
			panelName
		});
	}
</script>

<div class="flex h-full w-full flex-col justify-between">
	<div>
		<button
			class="p-2"
			on:click={() => {
				toggleSidePanel('fileExplorer');
			}}
		>
			<Icon icon="Files" />
		</button>
	</div>
	<div>
		<button class="p-2" on:click={() => toggleSidePanel('settings')}>
			<Icon icon="Settings" />
		</button>
	</div>
</div>

<style>
	button:hover {
		background-color: var(--hover-color);
	}
</style>
