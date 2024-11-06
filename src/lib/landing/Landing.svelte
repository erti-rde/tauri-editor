<script lang="ts">
	import type { TreeItem } from '../sourceSideBar/tree/Index.svelte';

	import { createEventDispatcher } from 'svelte';
	import { open } from '@tauri-apps/api/dialog';
	import { documentDir } from '@tauri-apps/api/path';
	import { readDir, type FileEntry } from '@tauri-apps/api/fs';
	import TreeItem from '$lib/sourceSideBar/tree/TreeItem.svelte';

	const dispatch = createEventDispatcher();

	async function handleFolderOpen() {
		// Open a selection dialog for directories
		const selected = await open({
			directory: true,
			multiple: false,
			defaultPath: await documentDir()
		});
		if (selected) {
			const dirPath = selected as string;
			const entries = await readDir(dirPath, { recursive: true });
			const convertedEntries: TreeItem[] = addIconField(entries)

			dispatch('projectOpen', {
				entries: convertedEntries
			});
		}
	}
  
	function addIconField(array) {
		array.forEach((item, i) => {
			if (item.children && Array.isArray(item.children)) {
				// It's a directory, so set the icon to 'folder'
				item.icon = 'Folder';
				// Recursively process children
				addIconField(item.children);
			} else if (item.name.endsWith(".pdf")) {
				// It's a file, so set the icon to 'file'
				item.icon = 'Pdf';
        // TODO: If file names have dots in it we won't get result we want. Consider all dots in the string
        item.name = item.name.split(".").shift()
			} else {
        // TODO: Remove Unsupported files
        item.privateItem = true
      }
		});
    return array
	}
</script>

<div>
	<p>To get started open your project</p>
	<button class="w-100px bg-orange-200 p-2" on:click={handleFolderOpen}>Open</button>
</div>

<style>
	div {
		display: flex;
		flex-direction: column;
		margin: auto 0;
	}
</style>
