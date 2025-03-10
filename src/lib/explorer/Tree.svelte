<script lang="ts">
	import FileItem from './TreeItem.svelte';
	import { fileSystemStore } from '$lib/stores/fileSystem';

	let rootPath = $state('');

	rootPath = $fileSystemStore.currentPath;
</script>

<div class="flex h-[100%] w-[100%] flex-col rounded-xl text-neutral-900">
	{#if rootPath}
		{#if $fileSystemStore.error}
			<div class="p-4 text-center">
				{$fileSystemStore.error}
			</div>
		{:else}
			<div class="">
				{#each $fileSystemStore.items as item}
					<FileItem {item} />
				{/each}
			</div>
		{/if}
	{/if}
</div>
