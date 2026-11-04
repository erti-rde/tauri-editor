<script lang="ts">
	import TreeRow from './TreeRow.svelte';

	/**
	 * A small file tree, as Files builds one: a folder with two files, and a file after it.
	 * With `checks`, each row has a box, as the Zotero picker's do; the folder's
	 * is ticked when both its files are, and mixed when one is.
	 */
	let {
		onselect = () => {},
		checks = false
	}: { onselect?: (name: string) => void; checks?: boolean } = $props();

	let open = $state(true);
	let ticked = $state<Record<string, boolean>>({});

	const box = (name: string) => (checks ? (ticked[name] ? 'checked' : 'unchecked') : undefined);
	const folder = $derived.by(() => {
		if (!checks) return undefined;
		const n = ['Chapter 1', 'Chapter 2'].filter((c) => ticked[c]).length;
		return n === 2 ? 'checked' : n === 1 ? 'mixed' : 'unchecked';
	});
	const tick = (name: string) => (ticked[name] = !ticked[name]);
	function tickFolder() {
		const on = folder !== 'checked';
		ticked['Chapter 1'] = on;
		ticked['Chapter 2'] = on;
	}
</script>

<button type="button">Before</button>
<div role="tree" aria-label="Files">
	<TreeRow
		level={1}
		label="Thesis"
		expanded={open}
		tabbable
		checked={folder}
		oncheck={tickFolder}
		onselect={() => (open = !open)}
		ontoggle={() => (open = !open)}
	/>
	{#if open}
		<TreeRow
			level={2}
			label="Chapter 1"
			selected
			meta="open"
			checked={box('Chapter 1')}
			oncheck={() => tick('Chapter 1')}
			onselect={() => onselect('Chapter 1')}
		/>
		<TreeRow
			level={2}
			label="Chapter 2"
			checked={box('Chapter 2')}
			oncheck={() => tick('Chapter 2')}
			onselect={() => onselect('Chapter 2')}
		/>
	{/if}
	<TreeRow level={1} label="Notes.txt" onselect={() => onselect('Notes.txt')} />
</div>
<button type="button">After</button>
