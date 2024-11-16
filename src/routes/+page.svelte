<script lang="ts">
	import { Explorer, Editor, StatusFooter, SidePanel, Landing } from '$lib';

	let isExplorerOpen = true;
	let vaultIsOpen = false;

	function handleToggleExplorer() {
		isExplorerOpen = !isExplorerOpen;
	}
</script>

<div
	class={vaultIsOpen ? `grid-styles grid h-screen w-screen overscroll-none` : `flex h-full w-full`}
>
	<div class="panel">
		<SidePanel on:toggleExplorer={handleToggleExplorer} />
	</div>
	{#if vaultIsOpen}
		<div class:explorer={isExplorerOpen} class:explorer-closed={!isExplorerOpen}>
			<Explorer {isExplorerOpen} />
		</div>
		<div class="editor overflow-y-auto">
			<Editor />
		</div>
	{:else}
		<div class="my-auto flex h-full w-full items-center justify-center">
			<Landing on:projectOpen={() => (vaultIsOpen = true)} />
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
