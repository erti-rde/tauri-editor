<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { CitationItem } from '$lib/stores/citationStore';
	import { Icon } from '$lib';
	import { citationStore } from '$lib/stores/citationStore';

	export let sentenceMetadata: {
		similarity: number;
		sentence: string;
		doi: string;
		metadata: CitationItem;
	};

	const dispatch = createEventDispatcher();
	let isExpanded = false;

	function generateCitation() {
		const inlineCitation = citationStore.getInlineCitation([sentenceMetadata.metadata.id]);
		dispatch('select', {
			citation: {
				id: JSON.stringify([sentenceMetadata.metadata.id]),
				inlineCitation
			}
		});
	}

	function toggleExpand() {
		isExpanded = !isExpanded;
	}

	// Helper to determine similarity score color
	function getSimilarityColor(score: number): string {
		if (score >= 0.8) return 'bg-green-200 text-green-800';
		if (score >= 0.6) return 'bg-lime-200 text-lime-800';
		if (score >= 0.4) return 'bg-yellow-200 text-yellow-800';
		if (score >= 0.2) return 'bg-orange-200 text-orange-800';
		return 'bg-red-100 text-red-800';
	}

	const similarityColor = getSimilarityColor(sentenceMetadata.similarity);
	const scorePercentage = Math.round(sentenceMetadata.similarity * 100);

	// Get URL from DOI or other source if available
	function getSourceUrl() {
		if (sentenceMetadata.doi) {
			return `https://doi.org/${sentenceMetadata.doi}`;
		}
		return null;
	}

	const sourceUrl = getSourceUrl();
	const needsExpander = sentenceMetadata.sentence.length > 120;
</script>

<div
	class="mb-2 overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow"
>
	<!-- Header with similarity score and title -->
	<div class="flex items-center">
		<div class={`flex h-12 w-12 items-center justify-center text-xs font-bold ${similarityColor}`}>
			{scorePercentage}%
		</div>
		<div class="ml-2 flex-1 text-sm font-medium text-gray-800">
			{sentenceMetadata.metadata.title}
		</div>
	</div>

	<!-- Citation text preview -->
	<div class="border-y border-gray-100 bg-gray-50 px-3 pb-0.5 pt-1.5 text-xs text-gray-700">
		<!-- Text content -->
		<div class="relative">
			<p class:line-clamp-2={!isExpanded} class="mb-1 pr-14 italic">
				{sentenceMetadata.sentence}
			</p>

			<!-- Fixed position expander button -->
			{#if needsExpander}
				<button
					class="absolute right-0 top-0 flex items-center bg-gray-50 p-1 text-sm text-gray-500 hover:text-gray-700"
					on:click={toggleExpand}
					aria-label={isExpanded ? 'Show less' : 'Show more'}
				>
					<span class="mr-1">{isExpanded ? 'Less' : 'More'}</span>
					{#if isExpanded}
						<Icon icon="ChevronUp" size="s" />
					{:else}
						<Icon icon="ChevronDown" size="s" />
					{/if}
				</button>
			{/if}
		</div>
	</div>

	<!-- Action buttons -->
	<div class="flex justify-start space-x-2 p-1.5">
		<button
			class="flex items-center space-x-1 rounded bg-orange-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-orange-200"
			on:click={generateCitation}
		>
			<Icon icon="Quote" size="s" />
			<span class="ml-1">Cite</span>
		</button>

		{#if sourceUrl}
			<a
				href={sourceUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="flex items-center space-x-1 rounded bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200"
			>
				<Icon icon="ExternalLink" size="s" />
				<span class="ml-1">View online</span>
			</a>
		{/if}
	</div>
</div>
