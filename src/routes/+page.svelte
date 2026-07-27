<script lang="ts">
	import { onMount } from 'svelte';
	import { homeDir, join } from '@tauri-apps/api/path';
	import { load as loadStore } from '@tauri-apps/plugin-store';
	import {
		Editor,
		Explorer,
		Landing,
		PdfReader,
		SidePanel,
		StatusFooter,
		MetadataEditor
	} from '$lib';
	import { openLibrary, openProject } from '$lib/stores/db';
	import { fileSystemStore, fileSystemState } from '$lib/stores/fileSystem.svelte';
	import { extractAndChunkPdfs } from '$utils/pdf_handlers';

	import type { PanelNames } from '$types/page';

	let isExplorerOpen = $state(true);
	let vaultIsOpen = $state(false);
	let panelName: PanelNames = $state('fileExplorer');

	function toggleSidePanel(newSidePanelName: PanelNames) {
		if (newSidePanelName === panelName || !isExplorerOpen) {
			isExplorerOpen = !isExplorerOpen;
		}
		panelName = newSidePanelName;
	}

	let isItPdf = $derived(() => {
		return fileSystemState.currentFile && fileSystemState.currentFile.endsWith('.pdf');
	});

	async function handleProjectOpening() {
		// The project database lives at <project>/.erti/project.db and is created
		// on first open, so each project keeps its own manuscripts, source set and
		// metadata corrections while sharing the one library of sources.
		await openProject($fileSystemStore.currentPath);
		vaultIsOpen = true;
		await extractAndChunkPdfs();
	}

	/**
	 * Where the shared source library lives.
	 *
	 * Configurable and defaulting to ~/Erti, the way Zotero exposes its data
	 * directory: a corpus is worth putting somewhere the user can back up or sync,
	 * rather than burying it in an application-support folder.
	 */
	async function libraryPath(): Promise<string> {
		const settings = await loadStore('settings-store.json');
		const configured = (await settings.get('libraryPath')) as string | undefined;
		if (configured) return configured;

		return join(await homeDir(), 'Erti', 'library.db');
	}

	onMount(async () => {
		try {
			await openLibrary(await libraryPath());
		} catch (error) {
			console.error('Failed to open the source library:', error);
		}
	});
</script>

<div class="flex h-screen flex-col">
	<div class="flex min-h-0 grow">
		<div class="min-w-(--toolbar-l) shrink-0">
			<SidePanel {toggleSidePanel} />
		</div>
		{#if vaultIsOpen}
			<div class={['shrink-0', !isExplorerOpen && 'w-0 p-0']}>
				<Explorer {isExplorerOpen} />
			</div>

			<div class="grow">
				{#if panelName == 'metadataExplorer'}
					<MetadataEditor />
				{:else if isItPdf()}
					<PdfReader />
				{:else}
					<Editor />
				{/if}
			</div>
		{:else}
			<div class="my-auto flex h-full w-full items-center justify-center">
				<Landing {handleProjectOpening} />
			</div>
		{/if}
	</div>
	<div class="z-10 shrink-0">
		<StatusFooter />
	</div>
</div>
