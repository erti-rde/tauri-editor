<script lang="ts">
	import Database from '@tauri-apps/plugin-sql';
	import { onMount } from 'svelte';
	import {
		Editor,
		Explorer,
		Landing,
		PdfReader,
		SidePanel,
		StatusFooter,
		MetadataEditor
	} from '$lib';
	import { dbStore } from '$lib/stores/db';
	import { fileSystemState } from '$lib/stores/fileSystem.svelte';
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
		vaultIsOpen = true;
		await extractAndChunkPdfs();
	}

	onMount(async () => {
		try {
			dbStore.setLoading(true);
			const db = await Database.load('sqlite:magnum_opus_test.db');
			dbStore.setDb(db);
		} catch (error) {
			dbStore.setError(error as Error);
			console.error('Failed to load database:', error);
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
