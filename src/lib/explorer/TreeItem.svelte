<script lang="ts">
	import { Icon } from '$lib';
	import type { FileItem } from '$lib/stores/fileSystem.svelte';
	import { fileSystemState } from '$lib/stores/fileSystem.svelte';
	import TreeItem from './TreeItem.svelte';
	import { workspaceStore } from '$lib/workspace/workspaceStore';
	import { documentsStore } from '$lib/stores/documents.svelte';
	import { isDocumentFile } from '$lib/editor/documents';
	import { errorToast } from '$lib/toast/Toast.svelte';
	import { get } from 'svelte/store';

	interface Props {
		item: FileItem;
		depth?: number;
	}

	let { item, depth = 0 }: Props = $props();

	let isExpanded = $state(false);

	function handleClick() {
		if (item.is_dir) {
			isExpanded = !isExpanded;
			return;
		}

		fileSystemState.currentFile = item.path;

		// Opening a file adds a tab rather than replacing what is on screen, so a
		// paper can sit beside the chapter that cites it.
		if (item.path.toLowerCase().endsWith('.pdf')) {
			workspaceStore.open({ id: item.path, kind: 'pdf', title: fileName(item.path) });
			return;
		}

		if (isDocumentFile(item.name)) {
			// The editor is what can actually open a manuscript — it has to save the
			// outgoing one and load the new content — so this asks rather than sets.
			const document = get(documentsStore).documents.find((d) => d.path === item.path);
			if (document) documentsStore.request(document);

			workspaceStore.open({
				id: item.path,
				kind: 'document',
				// documentsStore is the authority on titles; the file name is only a
				// fallback for a manuscript the listing has not caught up with yet.
				title: document?.title ?? item.name
			});
			return;
		}

		// Anything else — an exported .html, a stray .txt — has no viewer. Saying
		// so beats a click that silently does nothing, which is what this did.
		errorToast(`Erti cannot open ${item.name}. Only PDFs and manuscripts open in the editor.`);
	}

	/** The last path segment, without its extension — what a tab should say. */
	function fileName(path: string): string {
		const base = path.split(/[\\/]/).pop() ?? path;
		return base.replace(/\.pdf$/i, '');
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleClick();
		}
	}

	let indentation = $derived(`padding-left: ${depth * 1.25}rem`);
</script>

<div class="file-item">
	<div
		class="item-header"
		style={indentation}
		class:is-dir={item.is_dir}
		onclick={handleClick}
		onkeydown={handleKeyDown}
		role="button"
		tabindex="0"
	>
		<span class="icon">
			{#if item.is_dir}
				{#if isExpanded}
					<Icon icon="FolderOpen" size="s" />
				{:else}
					<Icon icon="Folder" size="s" />
				{/if}
			{:else}
				<Icon icon="File" size="s" />
			{/if}
		</span>
		<span class="name">{item.name}</span>
	</div>

	{#if item.is_dir && isExpanded && item.children}
		{#each item.children as child (child.path)}
			<TreeItem item={child} depth={depth + 1} />
		{/each}
	{/if}
</div>

<style>
	.file-item {
		font-size: 0.9rem;
		user-select: none;
	}

	.item-header {
		display: flex;
		align-items: center;
		padding: 0.25rem;
		cursor: pointer;
		gap: 0.5rem;
	}

	.item-header:hover {
		background-color: hsl(var(--surface-raised));
	}

	.icon {
		display: flex;
		align-items: center;
		color: hsl(var(--ink-muted));
	}

	.is-dir {
		font-weight: 500;
	}

	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
