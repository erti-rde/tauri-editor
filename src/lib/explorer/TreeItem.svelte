<script lang="ts">
	import { Icon } from '$lib';
	import type { FileItem } from '$lib/stores/fileSystem';
	import { currentFileStore } from '$lib/stores/openFileStore';
	import TreeItem from './TreeItem.svelte';

	interface Props {
		item: FileItem;
		depth?: number;
	}

	let { item, depth = 0 }: Props = $props();

	let isExpanded = $state(false);

	function handleClick() {
		if (item.is_dir) {
			isExpanded = !isExpanded;
		} else {
			currentFileStore.set(item.path);
		}
	}

	let indentation = $derived(`padding-left: ${depth * 1.25}rem`);
</script>

<div class="file-item">
	<div class="item-header" style={indentation} class:is-dir={item.is_dir} onclick={handleClick}>
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
		{#each item.children as child}
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
		background-color: rgba(0, 0, 0, 0.1);
	}

	.icon {
		display: flex;
		align-items: center;
		color: #666;
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
