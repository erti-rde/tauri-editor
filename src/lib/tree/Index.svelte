<script lang="ts" context="module">
	import { appLocalDataDir, join as pathJoin } from '@tauri-apps/api/path';
	import { readDir, createDir, exists } from '@tauri-apps/api/fs';

	export type TreeItem = {
		fileName: string;
		icon: 'folder' | 'file' | string;
		children?: TreeItem[];
	};

	export async function getSources() {
		try {
			const sourcesLocation = await appLocalDataDir();
			const pickleFilesDir = await pathJoin(sourcesLocation, 'pickle_files');
			const pickleFilesExists = await exists(pickleFilesDir);

			if (!pickleFilesExists) {
				await createDir(pickleFilesDir);
			}

			const sources = await readDir(pickleFilesDir);
			const treeData: {
				fileName: string;
				icon: string;
			}[] = [];
			sources.length > 0 &&
				sources.forEach((source) => {
					// regex to match a fileName which is between pickle_files and .pdf.pickle
					const regex = /pickle_files(?:\/|\\)(.*).pdf.pickle/;
					const match = source.path.match(regex);
					if (!match) return;
					const sourceName = match[1];
					treeData.push({
						fileName: sourceName,
						icon: 'file'
					});
				});
			return treeData;
		} catch (error) {
			console.error(`🚀 ~ error`, error);
		}
	}
</script>

<script lang="ts">
	import { createTreeView } from '@melt-ui/svelte';
	import { setContext } from 'svelte';

	import { Icon } from '$lib';
	import TreeItemComponent from './TreeItem.svelte';

	const ctx = createTreeView({
		defaultExpanded: ['lib-0', 'tree-0']
	});
	setContext('tree', ctx);

	const {
		elements: { tree }
	} = ctx;

	export let treeItems: TreeItem[] | undefined;

	async function resetItems() {
		treeItems = await getSources();
	}
</script>

<div class="flex h-[100%] w-[18.75rem] flex-col rounded-xl bg-white text-neutral-900">
	<div class="flex flex-col gap-1 px-4 pt-4">
		<h3 class="text-lg font-bold">Sources</h3>
		<hr />
	</div>

	<ul class="overflow-auto px-4 pb-4 pt-2" {...$tree}>
		{#if treeItems && treeItems.length > 0}
			{#key treeItems}
				{#each treeItems as { fileName }, i}
					<li class="mb-[10px] flex">
						<div class="mr-[10px] flex items-center">
							<Icon icon="ph:file-pdf" />
						</div>

						<span class="grow overflow-x-hidden whitespace-nowrap">{fileName}</span>
						<TreeItemComponent {fileName} on:sourceDeleted={resetItems} />
					</li>
				{/each}
			{/key}
		{:else}
			<p class="text-center">No sources added yet</p>
		{/if}
	</ul>
</div>

<style>
	li:focus {
		box-shadow: none !important;
	}
	:global(li .edit-delete-icons) {
		display: none;
	}
	:global(li:hover .edit-delete-icons) {
		display: flex;
		align-items: center;
		gap: 10px;
	}
</style>
