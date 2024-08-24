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
	import AddSource from '$lib/sourceSideBar/AddSource.svelte';

	const ctx = createTreeView({
		defaultExpanded: ['lib-0', 'tree-0']
	});
	setContext('tree', ctx);

	const {
		elements: { tree }
	} = ctx;

	let treeItems: TreeItem[] | undefined;

	getSources().then((sources) => {
		treeItems = sources;
	});

	async function resetItems() {
		treeItems = await getSources();
	}
</script>

<div class="flex h-[100%] w-[18.75rem] flex-col rounded-xl text-neutral-900">
	<div class="mt-4 flex justify-end">
		<AddSource on:sourceAdded={resetItems} />
	</div>

	<ul class="overflow-auto pb-4 pt-2" {...$tree}>
		{#if treeItems && treeItems.length > 0}
			{#key treeItems}
				{#each treeItems as { fileName }, i}
					<li class="mb-2 flex">
						<div>
							<Icon icon="Pdf" />
						</div>

						<span class="ml-1 flex-shrink overflow-x-hidden whitespace-nowrap">{fileName}</span>
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
	}

	.add-file:hover {
		background-color: var(--hover-color);
	}
</style>
