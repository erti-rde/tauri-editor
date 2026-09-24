<script lang="ts">
	import FileItem from './TreeItem.svelte';
	import { fileSystemStore } from '$lib/stores/fileSystem.svelte';

	let rootPath = $state('');

	rootPath = $fileSystemStore.currentPath;
</script>

<div class="text-ink flex h-[100%] w-[100%] flex-col rounded-xl">
	{#if rootPath}
		{#if $fileSystemStore.error}
			<div class="p-4 text-center">
				{$fileSystemStore.error}
			</div>
		{:else}
			<div class="">
				{#each $fileSystemStore.items as item (item.path)}
					<FileItem {item} />
				{/each}
			</div>
		{/if}
	{/if}
</div>
