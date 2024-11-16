<script lang="ts">
	import { Icon } from '$lib';
	import type { FileItem } from '$lib/stores/fileSystem';

	export let item: FileItem;
	export let depth: number = 0;

	let isExpanded = false;

	function toggleExpand() {
		if (item.is_dir) {
			isExpanded = !isExpanded;
		}
	}

	$: indentation = `padding-left: ${depth * 1.25}rem`;
</script>

<div class="file-item">
	<div class="item-header" style={indentation} on:click={toggleExpand} class:is-dir={item.is_dir}>
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
			<svelte:self item={child} depth={depth + 1} />
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
