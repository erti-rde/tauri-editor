<script lang="ts">
	import FileItem from './TreeItem.svelte';
	import { EmptyState } from '$lib/ui';
	import { fileSystemStore } from '$lib/stores/fileSystem.svelte';

	let rootPath = $state('');

	rootPath = $fileSystemStore.currentPath;
</script>

<div class="text-ink flex h-full w-full flex-col">
	{#if rootPath}
		{#if $fileSystemStore.error}
			<EmptyState message={$fileSystemStore.error} />
		{:else}
			<div role="tree" aria-label="Files" class="py-1">
				{#each $fileSystemStore.items as item, index (item.path)}
					<FileItem {item} tabbable={index === 0} />
				{/each}
			</div>
		{/if}
	{/if}
</div>
