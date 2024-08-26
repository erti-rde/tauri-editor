<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { createEventDispatcher } from 'svelte';
	import { fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import ResultCard from './ResultCard.svelte';
	import { Loader } from '$lib';

	import { findSimilarSentences } from '$utils/api';

	import type { responseDetails } from '$utils/api';

	export let selectedText: string;
	let open = true;
	let panelElement: HTMLElement;

	onMount(() => {
		document.addEventListener('mousedown', handleClickOutside);
	});

	onDestroy(() => {
		document.removeEventListener('mousedown', handleClickOutside);
	});

	function handleClickOutside(event: MouseEvent) {
		if (open && panelElement && !panelElement.contains(event.target as Node)) {
			open = false;
			selectedText = '';
			dispatch('close-panel');
		}
	}

	async function handleQuery(query: string): Promise<responseDetails[]> {
		const similarSentences = await findSimilarSentences(query);

		return similarSentences;
	}

	const results = handleQuery(selectedText);

	const dispatch = createEventDispatcher();

	function handleSelect(event: CustomEvent) {
		const { citation } = event.detail;
		dispatch('select', { citation, selectedText });
		selectedText = '';
		open = false;
	}
</script>

{#if open}
	<div
		class="results-wrapper"
		bind:this={panelElement}
		transition:fly={{ delay: 0, duration: 500, x: 100, y: 0, easing: quintOut }}
	>
		<h3 class="p-4">Top Matching results:</h3>
		{#await results}
			<div class="flex h-[50%] w-[100%] flex-col items-center justify-center">
				<p class="p-4">Searching for citation:</p>
				<Loader />
			</div>
		{:then similarSentences}
			{#if similarSentences.length > 0}
				{#each similarSentences as sentence}
					<ResultCard metadata={sentence} on:select={handleSelect} />
				{/each}
			{:else}
				<p class="p-4">No results found</p>
			{/if}
		{:catch error}
			<p class="p-4">Error: {error.message}</p>
		{/await}
	</div>
{/if}

<style>
	.results-wrapper {
		position: fixed;
		top: var(--title-bar-height);
		right: 0;
		width: 30%;
		height: calc(100% - var(--title-bar-height));
		background-color: white;
		box-shadow: -5px 0 5px -5px rgba(0, 0, 0, 0.5);
		z-index: 5;
    overflow-y: auto;
	}
</style>
