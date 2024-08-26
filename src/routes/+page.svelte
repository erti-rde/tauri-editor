<script lang="ts">
	import { SourceSideBar, Editor, StatusFooter, SidePanel } from '$lib';
	let isExplorerOpen = true;

	function handleToggleExplorer() {
		isExplorerOpen = !isExplorerOpen;
	}
</script>

<div class="grid-styles grid h-screen w-screen overscroll-none">
	<div class="panel">
		<SidePanel on:toggleExplorer={handleToggleExplorer} />
	</div>
	<div class="explorer" class:hidden={!isExplorerOpen}>
		<SourceSideBar bind:isOpen={isExplorerOpen} />
	</div>
	<div class="editor overflow-y-auto">
		<Editor />
	</div>
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
