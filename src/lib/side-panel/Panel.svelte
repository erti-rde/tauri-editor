<script lang="ts">
	import { Icon } from '$lib';
	import Settings from '$lib/settings/Settings.svelte';

	interface Props {
		toggleSidePanel: (panelName: string) => void;
	}

	const { toggleSidePanel }: Props = $props();

	let showSettings = $state(false);

	function toggleSettings() {
		showSettings = !showSettings;
	}

	function closeSettings() {
		showSettings = false;
	}
</script>

<div class="flex h-full w-full flex-col justify-between">
	<div>
		<button class="p-2" onclick={() => toggleSidePanel('fileExplorer')}>
			<Icon icon="Files" />
		</button>
	</div>
	<div>
		<button class="p-2" onclick={toggleSettings}>
			<Icon icon="Settings" />
		</button>
	</div>
</div>

<Settings isOpen={showSettings} {closeSettings} />

<style>
	button:hover {
		background-color: var(--hover-color);
	}
</style>
