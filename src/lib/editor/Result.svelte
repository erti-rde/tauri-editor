<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import ResultCard from './ResultCard.svelte';
	import { Loader } from '$lib';

	import { findSimilarSentences } from '$utils/api';

	import type { responseDetails } from '$utils/api';

	let similarSentences: responseDetails[] = [];
	let open = false;
	let selectedText: string;

	window.addEventListener('citation', async (event) => {
		const { startOffset, endOffset, commonAncestorContainer } = event.detail.range;
		console.log(`🚀 ~ commonAncestorContainer:`, commonAncestorContainer);
		const currentSelectedText = commonAncestorContainer?.data.slice(startOffset, endOffset);
		if (selectedText === currentSelectedText) {
			selectedText = '';
			open = !open;
			return;
		}
		similarSentences = [];
		selectedText = currentSelectedText;
		open = true;
		await handleQuery(selectedText);
	});

	async function handleQuery(query: string) {
		similarSentences = await findSimilarSentences(query);
	}

	const dispatch = createEventDispatcher();

	function handleSelect(event: CustomEvent) {
		const { citation } = event.detail;
		dispatch('select', { citation, selectedText });
		similarSentences = [];
		selectedText = '';
		open = false;
	}
</script>

{#if open}
	<div
		class="results-wrapper"
		transition:fly={{ delay: 0, duration: 500, x: 100, y: 0, easing: quintOut }}
	>
		<h3 class="p-4">Top Matching results:</h3>
		{#if similarSentences.length > 0}
			{#each similarSentences as sentence}
				<ResultCard metadata={sentence} on:select={handleSelect} />
			{/each}
		{:else}
			<div class="flex h-[50%] w-[100%] flex-col items-center justify-center">
				<p class="p-4">Searching for citation:</p>
				<Loader />
			</div>
		{/if}
	</div>
{/if}

<style>
	.results-wrapper {
		position: fixed;
		top: 0;
		right: 0;
		width: 30%;
		height: 100%;
		background-color: white;
		box-shadow: -5px 0 5px -5px rgba(0, 0, 0, 0.5);
		z-index: 5;
	}
</style>
