<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';

	import Combobox from './Combobox.svelte';

	/**
	 * A `Combobox` as the editor drives it, for tests: a field keeps focus and
	 * passes its keys on.
	 */
	interface Source {
		id: string;
		title: string;
		cannot?: boolean;
	}

	interface Props {
		items: Source[];
		multiple?: boolean;
		onchoose?: (item: Source) => void;
	}

	let { items, multiple = false, onchoose = () => {} }: Props = $props();

	let field = $state<HTMLInputElement | null>(null);
	let combobox = $state<ReturnType<typeof Combobox<Source>>>();
	const chosen = new SvelteSet<string>();
</script>

<!-- A raw field, as the manuscript is to the picker: anything that keeps focus. -->
<input
	bind:this={field}
	aria-label="Query"
	onkeydown={(event) => {
		if (combobox?.keydown(event)) event.preventDefault();
	}}
/>

<Combobox
	bind:this={combobox}
	label="Sources"
	{items}
	key={(item) => item.id}
	owner={field}
	{multiple}
	selected={(item) => chosen.has(item.id)}
	disabled={(item) => !!item.cannot}
	onchoose={(item) => {
		if (chosen.has(item.id)) chosen.delete(item.id);
		else chosen.add(item.id);
		onchoose(item);
	}}
>
	{#snippet option({ item })}
		<span>{item.title}</span>
	{/snippet}
	{#snippet empty()}
		<p>No sources match.</p>
	{/snippet}
	{#snippet footer()}
		<span>Enter to choose</span>
	{/snippet}
</Combobox>
