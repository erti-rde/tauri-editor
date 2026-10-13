<script lang="ts">
	import Files from '~icons/lucide/files';
	import ListTree from '~icons/lucide/list-tree';
	import Pencil from '~icons/lucide/pencil';
	import ScanText from '~icons/lucide/scan-text';
	import SettingsIcon from '~icons/lucide/settings';
	import Books from '~icons/mdi/bookshelf';

	import { IconButton } from '$lib/ui';
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

	/** The rail, top to bottom. Check sits between Notes and Sources (UX-7). */
	const PANELS: { name: PanelNames; label: string; icon: typeof Files }[] = [
		{ name: 'fileExplorer', label: 'Files', icon: Files },
		{ name: 'outline', label: 'Outline', icon: ListTree },
		{ name: 'notes', label: 'Notes', icon: Pencil },
		{ name: 'check', label: 'Check', icon: ScanText },
		{ name: 'metadataExplorer', label: 'Sources', icon: Books }
	];
</script>

<div class="flex h-full w-full flex-col items-center justify-between border-r pt-2">
	<div class="flex flex-col gap-1">
		{#each PANELS as panel (panel.name)}
			<IconButton
				label={panel.label}
				icon={panel.icon}
				side="right"
				onclick={() => toggleSidePanel(panel.name)}
			/>
		{/each}
	</div>
	<div class="pb-1">
		<IconButton label="Settings" icon={SettingsIcon} side="right" onclick={toggleSettings} />
	</div>
</div>

<Settings isOpen={showSettings} {closeSettings} />
