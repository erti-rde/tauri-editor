<script lang="ts">
	import { fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import ResultCard from './ResultCard.svelte';
	import { Loader } from '$lib';

	import { invoke } from '@tauri-apps/api/core';
  import { dbStore } from '$lib/stores/db';
	import { citationStore } from '$lib/stores/citationStore';

	import type { EmbeddingResult } from '$utils/pdf_handlers';
	import type { CitationItem } from '$lib/stores/citationStore';
	import { clickOutside } from '$utils/clickOutside.svelte';

  const { executeQuery } = dbStore;

  interface Props {
		selectedText: string;
		closePanel: () => void;
		selectCitation: (citation: { id: string; inlineCitation: string }) => void;
	}

	let { selectedText, closePanel, selectCitation }: Props = $props();

	async function handleQuery(query: string): Promise<
		{
			metadata: CitationItem;
			sentence: string;
			similarity: number;
			id: string;
		}[]
	> {
		const similarSentences = await searchSimilarChunks(query);
		return similarSentences;
	}

	const results = handleQuery(selectedText);

	async function searchSimilarChunks(query: string, topK: number = 5) {
		query = selectedText;
		try {
			// Get query embedding
			const queryEmbeddingResult = (await invoke('embed_chunks', {
				chunks: [query]
			})) as EmbeddingResult[];

			const queryEmbedding = queryEmbeddingResult[0].embedding;

			// Get all chunks and their embeddings from database
			const chunks = (await executeQuery(`
			 SELECT
				chunks.chunk_text,
				chunks.embedding,
				files.id
			FROM
			   chunks
			JOIN
			   files ON chunks.file_id = files.id
			`)) as { chunk_text: string; embedding: string; id: string }[];
			// Calculate similarities
			const similarities = chunks.map((chunk) => {
				const chunkEmbedding = JSON.parse(chunk.embedding);
				const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);

				return {
					sentence: chunk.chunk_text,
					similarity,
					id: chunk.id
				};
			});

			// Sort by similarity in descending order and take top K
			const topResults = similarities.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
			const citationSources = citationStore.getAllSourcesAsJson();
			// Add metadata to top results only
			const resultsWithMetadata = topResults.map((result) => {
				let metadata = null;

				if (result.id && citationSources[result.id]) {
					metadata = citationSources[result.id];
				}
				// If no matching citation found, use placeholder metadata
				if (!metadata) {
					metadata = {
						id: `unknown-${Date.now()}`,
						type: 'article-journal',
						title: 'Unknown Title',
						author: [
							{
								family: 'Unknown',
								given: 'Author'
							}
						]
					};
				}

				return {
					...result,
					metadata
				};
			});

			console.log({ resultsWithMetadata });
			return resultsWithMetadata;
		} catch (error) {
			console.error('Error in similarity search:', error);
			throw error;
		}
	}

	function cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) {
			throw new Error('Vectors must have same length');
		}

		let dotProduct = 0;
		let normA = 0;
		let normB = 0;

		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}

		normA = Math.sqrt(normA);
		normB = Math.sqrt(normB);

		if (normA === 0 || normB === 0) {
			return 0;
		}

		return dotProduct / (normA * normB);
	}
</script>

<div
	class="results-wrapper"
	transition:fly={{ delay: 0, duration: 500, x: 100, y: 0, easing: quintOut }}
	use:clickOutside
	onoutclick={closePanel}
>
	<h3 class="p-4">Top Matching results:</h3>
	{#await results}
		<div class="flex h-[50%] w-[100%] flex-col items-center justify-center">
			<p class="p-4">Searching for citation:</p>
			<Loader />
		</div>
	{:then similarSentences}
		{#if similarSentences.length > 0}
			{#each similarSentences as sentenceMetadata}
				<ResultCard {sentenceMetadata} {selectCitation} />
			{/each}
		{:else}
			<p class="p-4">No results found</p>
		{/if}
	{:catch error}
		<p class="p-4">Error: {error.message}</p>
	{/await}
</div>

<style>
	.results-wrapper {
		position: absolute;
		right: 0;
		width: 30%;
		height: calc(100% - var(--footer-status-bar-height) - var(--toolbar-l));
		background-color: white;
		box-shadow: -5px 0 5px -5px rgba(0, 0, 0, 0.5);
		z-index: 5;
		overflow-y: auto;
	}
</style>
