<script lang="ts">
	import { Icon } from '$lib';
	import Settings from './settings/Settings.svelte';

	import type { PanelNames } from '$types/page';
	interface Props {
		toggleSidePanel: (panelName: PanelNames) => void;
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

<div class="flex h-full w-full flex-col items-center justify-between border-r pt-2">
	<div class="flex flex-col">
		<button
			class="p-1"
			onclick={() => toggleSidePanel('fileExplorer')}
			aria-label="Files"
			title="Files"
		>
			<Icon icon="Files" />
		</button>
		<button
			class="p-1"
			onclick={() => toggleSidePanel('outline')}
			aria-label="Outline"
			title="Outline"
		>
			<Icon icon="ListTree" />
		</button>
		<button
			class="p-1"
			onclick={() => toggleSidePanel('metadataExplorer')}
			aria-label="Sources"
			title="Sources"
		>
			<Icon icon="Books" />
		</button>
	</div>
	<div>
		<button class="p-1" onclick={toggleSettings} aria-label="Settings" title="Settings">
			<Icon icon="Settings" />
		</button>
	</div>
</div>

<Settings isOpen={showSettings} {closeSettings} />

<style>
	button:hover {
		background-color: hsl(var(--surface-raised));
		border-radius: 4px;
	}
</style>
