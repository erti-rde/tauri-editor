<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { Icon } from '$lib';
	import Settings from '$lib/settings/Settings.svelte';

	const dispatch = createEventDispatcher();
	let showSettings = false;

	function toggleSidePanel(panelName: string) {
		dispatch('toggleSidePanel', {
			panelName
		});
	}

	function toggleSettings() {
		showSettings = !showSettings;
	}

	function closeSettings() {
		showSettings = false;
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
		<button class="p-2" on:click={toggleSettings}>
			<Icon icon="Settings" />
		</button>
	</div>
</div>

<Settings isOpen={showSettings} on:close={closeSettings} />

<style>
	button:hover {
		background-color: var(--hover-color);
	}
</style>
