<script lang="ts">
	import type { CitationItem } from '$lib/stores/citationStore';
	import { Icon } from '$lib';

	interface Props {
		sentenceMetadata: {
			similarity: number;
			sentence: string;
			metadata: CitationItem;
			page_start?: number | null;
			section?: string | null;
			in_project?: boolean;
		};
		/** Cite this match. The parent adds it to the project first if needed. */
		oncite: () => void;
		busy?: boolean;
	}

	let { sentenceMetadata, oncite, busy = false }: Props = $props();

	let isExpanded = $state(false);

	function toggleExpand() {
		isExpanded = !isExpanded;
	}

	// Helper to determine similarity score color
	function getSimilarityColor(score: number): string {
		if (score >= 0.8) return 'bg-surface-sunken text-success';
		if (score >= 0.6) return 'bg-surface-sunken text-success';
		if (score >= 0.4) return 'bg-surface-sunken text-warning';
		if (score >= 0.2) return 'bg-accent-quiet text-accent';
		return 'bg-surface-sunken text-danger';
	}

	const similarityColor = getSimilarityColor(sentenceMetadata.similarity);
	const scorePercentage = Math.round(sentenceMetadata.similarity * 100);

	// Get URL from DOI or other source if available
	function getSourceUrl() {
		if (sentenceMetadata.metadata.DOI) {
			return `https://doi.org/${sentenceMetadata.metadata.DOI}`;
		}
		return null;
	}

	const sourceUrl = getSourceUrl();
	const needsExpander = sentenceMetadata.sentence.length > 120;
</script>

<div
	class="border-line bg-surface-raised mb-2 overflow-hidden rounded-md border shadow-sm transition-shadow hover:shadow"
>
	<!-- Header with similarity score and title -->
	<div class="flex items-center">
		<div class={`flex h-12 w-12 items-center justify-center text-xs font-bold ${similarityColor}`}>
			{scorePercentage}%
		</div>
		<div class="text-ink ml-2 flex-1 text-sm font-medium">
			{sentenceMetadata.metadata.title}
		</div>
	</div>

	<!-- Citation text preview -->
	<div class="border-line bg-surface-sunken text-ink border-y px-3 pt-1.5 pb-0.5 text-xs">
		<!-- Text content -->
		<div class="relative">
			<p class:line-clamp-2={!isExpanded} class="mb-1 pr-14 italic">
				{sentenceMetadata.sentence}
			</p>

			<!-- Fixed position expander button -->
			{#if needsExpander}
				<button
					class="bg-surface-sunken text-ink-muted hover:text-ink absolute top-0 right-0 flex items-center p-1 text-sm"
					onclick={toggleExpand}
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

	<!--
		Where the passage is, which is what Phase 2 recorded page and section for:
		"p. 4, Results" is what lets a researcher check a quotation against the PDF.
	-->
	{#if sentenceMetadata.page_start || sentenceMetadata.section}
		<p class="text-ink-muted px-1.5 text-xs">
			{#if sentenceMetadata.page_start}p. {sentenceMetadata.page_start}{/if}{#if sentenceMetadata.page_start && sentenceMetadata.section},
			{/if}{#if sentenceMetadata.section}{sentenceMetadata.section}{/if}
		</p>
	{/if}

	<!-- Action buttons -->
	<div class="flex justify-start space-x-2 p-1.5">
		<!--
			A source from outside the project says so, because citing it changes the
			project: it joins this project's sources. Adding silently would leave the
			researcher unsure which papers a project actually contains.
		-->
		<button
			class="bg-accent-quiet text-ink hover:bg-accent-quiet flex items-center space-x-1 rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60"
			onclick={oncite}
			disabled={busy}
			title={sentenceMetadata.in_project === false
				? 'Add this source to the project and cite it'
				: 'Cite this source'}
		>
			<Icon icon="Quote" size="s" />
			<span class="ml-1">
				{#if busy}
					Adding…
				{:else if sentenceMetadata.in_project === false}
					Add &amp; cite
				{:else}
					Cite
				{/if}
			</span>
		</button>

		{#if sourceUrl}
			<!-- sourceUrl is an external DOI or publisher link from the source metadata,
			     not SvelteKit navigation, so resolve() does not apply. -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<a
				href={sourceUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="bg-surface-sunken text-ink hover:bg-surface-sunken flex items-center space-x-1 rounded px-3 py-1.5 text-xs font-medium transition-colors"
			>
				<Icon icon="ExternalLink" size="s" />
				<span class="ml-1">View online</span>
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
	</div>
</div>
