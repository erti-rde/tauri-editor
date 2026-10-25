<script lang="ts">
	import File from '~icons/lucide/file';
	import FileText from '~icons/lucide/file-text';
	import FileType from '~icons/lucide/file-type-2';
	import Folder from '~icons/lucide/folder';
	import FolderOpen from '~icons/lucide/folder-open';

	import { TreeRow } from '$lib/ui';
	import type { FileItem } from '$lib/stores/fileSystem.svelte';
	import { fileSystemState } from '$lib/stores/fileSystem.svelte';
	import TreeItem from './TreeItem.svelte';
	import { workspaceStore } from '$lib/workspace/workspaceStore';
	import { documentsStore } from '$lib/stores/documents.svelte';
	import { isDocumentFile } from '$lib/editor/documents';
	import { errorToast } from '$lib/ui/Toast.svelte';
	import { get } from 'svelte/store';

	interface Props {
		item: FileItem;
		depth?: number;
		/** The row a Tab into Files lands on: the first. */
		tabbable?: boolean;
	}

	let { item, depth = 0, tabbable = false }: Props = $props();

	let isExpanded = $state(false);

	// Open, in either pane: the tab strip's choice, said here in words as well
	// as by the row's ground.
	const open = $derived(
		!item.is_dir && $workspaceStore.panes.some((pane) => pane.active === item.path)
	);

	const icon = $derived(
		item.is_dir
			? isExpanded
				? FolderOpen
				: Folder
			: item.path.toLowerCase().endsWith('.pdf')
				? FileType
				: isDocumentFile(item.name)
					? FileText
					: File
	);

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
</script>

<TreeRow
	level={depth + 1}
	label={item.name}
	{icon}
	expanded={item.is_dir ? isExpanded : undefined}
	selected={open}
	meta={open ? 'open' : undefined}
	{tabbable}
	onselect={handleClick}
	ontoggle={() => (isExpanded = !isExpanded)}
/>

{#if item.is_dir && isExpanded && item.children}
	{#each item.children as child (child.path)}
		<TreeItem item={child} depth={depth + 1} />
	{/each}
{/if}
