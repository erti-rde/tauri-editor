<script lang="ts">
	import TreeRow from './TreeRow.svelte';

	/** A small file tree, as Files builds one: a folder with two files, and a file after it. */
	let { onselect = () => {} }: { onselect?: (name: string) => void } = $props();

	let open = $state(true);
</script>

<button type="button">Before</button>
<div role="tree" aria-label="Files">
	<TreeRow
		level={1}
		label="Thesis"
		expanded={open}
		tabbable
		onselect={() => (open = !open)}
		ontoggle={() => (open = !open)}
	/>
	{#if open}
		<TreeRow
			level={2}
			label="Chapter 1"
			selected
			meta="open"
			onselect={() => onselect('Chapter 1')}
		/>
		<TreeRow level={2} label="Chapter 2" onselect={() => onselect('Chapter 2')} />
	{/if}
	<TreeRow level={1} label="Notes.txt" onselect={() => onselect('Notes.txt')} />
</div>
<button type="button">After</button>
