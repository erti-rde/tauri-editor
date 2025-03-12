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
	import { currentFileStore } from '$lib/stores/openFileStore';
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
		return $currentFileStore && $currentFileStore.endsWith('.pdf');
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

<div
	class={vaultIsOpen ? `grid-styles grid h-screen w-screen overscroll-none` : `flex h-full w-full`}
>
	<div class="panel">
		<SidePanel {toggleSidePanel} />
	</div>
	{#if vaultIsOpen}
		<div class:explorer={isExplorerOpen} class:explorer-closed={!isExplorerOpen}>
			<Explorer {isExplorerOpen} />
		</div>
		<div class="editor overflow-y-auto">
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
<div class="status-bar">
	<StatusFooter />
</div>

<style>
	.grid-styles {
		grid-template-columns: 40px auto 4fr;
		grid-template-rows: 1fr var(--footer-status-bar-height);
	}
	.panel,
	.explorer,
	.editor {
		height: calc(100vh - var(--footer-status-bar-height));
	}
	.status-bar {
		grid-column: span 3;
	}
	.explorer-closed {
		width: 0;
	}
</style>
