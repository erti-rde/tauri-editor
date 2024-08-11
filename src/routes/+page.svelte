<script lang="ts">
	import { SourceSideBar, Editor, StatusFooter, SidePanel } from '$lib';
</script>

<div class="grid-styles grid h-screen w-screen overscroll-none">
	<div class="panel">
		<SidePanel />
	</div>
	<div class="explorer">
		<SourceSideBar />
	</div>
	<div class="editor">
		<Editor />
	</div>
</div>
<div class="status-bar">
	<StatusFooter />
</div>

<style>
	.grid-styles {
		grid-template-columns: 40px auto 4fr;
		grid-template-rows: 1fr var(--footer-status-bar-heightt);
	}
	.panel,
	.explorer,
	.editor {
		height: calc(100vh - var(--footer-status-bar-heightt));
		overflow-y: auto;
	}
	.panel,
	.explorer {
		border-right: 1px solid rgb(144, 144, 144);
	}
	.status-bar {
		grid-column: span 3;
	}
</style>
