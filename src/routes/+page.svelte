<script lang="ts">
	import { SourceSideBar, Editor, StatusFooter, SidePanel, Landing } from '$lib';
  import type {TreeItem} from '../lib/sourceSideBar/tree/Index.svelte'
  
	let isExplorerOpen = true;
	let vaultIsOpen = false;
  let directoryEntries: TreeItem[] = []

	function handleToggleExplorer() {
		isExplorerOpen = !isExplorerOpen;
	}

  function handleDirOpen(e: CustomEvent) {
    vaultIsOpen = true
    directoryEntries = e.detail.entries
  }
</script>

<div class={vaultIsOpen ? `grid-styles grid h-screen w-screen overscroll-none` : `flex w-full h-full`}>
	<div class="panel">
		<SidePanel on:toggleExplorer={handleToggleExplorer} />
	</div>
	{#if vaultIsOpen}
		<div class="explorer" class:hidden={!isExplorerOpen}>
			<SourceSideBar bind:directoryEntries={directoryEntries}  />
		</div>
		<div class="editor overflow-y-auto">
			<Editor />
		</div>
	{:else}
		<div class="flex h-full w-full items-center justify-center my-auto">
			<Landing on:projectOpen={handleDirOpen} />
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
	.hidden {
		display: none;
	}
</style>
