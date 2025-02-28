<script lang="ts">
	import { onMount } from 'svelte';
	import Database from '@tauri-apps/plugin-sql';

	import { Explorer, Editor, StatusFooter, SidePanel, Landing, PdfReader } from '$lib';
	import { currentFileStore } from '$lib/stores/openFileStore';
	import { dbStore } from '$lib/stores/db';
	import { extractAndChunkPdfs } from '$utils/pdf_handlers';

	let isExplorerOpen = true;
	let vaultIsOpen = false;
	let panelName = 'fileExplorer';

	function handleToggleSidePanel(e: CustomEvent) {
		if (e.detail.panelName === panelName || !isExplorerOpen) {
			isExplorerOpen = !isExplorerOpen;
		}
		panelName = e.detail.panelName;
	}

	$: isItPdf = () => {
		return $currentFileStore && $currentFileStore.endsWith('.pdf');
	};

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
		<SidePanel on:toggleSidePanel={handleToggleSidePanel} />
	</div>
	{#if vaultIsOpen}
		<div class:explorer={isExplorerOpen} class:explorer-closed={!isExplorerOpen}>
			<Explorer {isExplorerOpen} />
		</div>
		<div class="editor overflow-y-auto">
			{#if isItPdf()}
				<PdfReader />
			{:else}
				<Editor />
			{/if}
		</div>
	{:else}
		<div class="my-auto flex h-full w-full items-center justify-center">
			<Landing on:projectOpen={handleProjectOpening} />
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
	.panel,
	.explorer {
		border-right: 1px solid rgb(144, 144, 144);
	}
	.status-bar {
		grid-column: span 3;
	}
	.explorer-closed {
		width: 0;
	}
</style>
