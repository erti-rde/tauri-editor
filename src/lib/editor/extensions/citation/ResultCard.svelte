<script lang="ts">
	import type { CitationItem } from '$lib/stores/citationStore';
	import { Icon } from '$lib';
	import { showInPdf } from '$lib/pdfreader/showInPdf';

	interface Props {
		sentenceMetadata: {
			/** The paper this passage came from, by content hash. */
			sha256: string;
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

	/**
	 * Open the paper at this passage.
	 *
	 * The card has said "p. 4, Results" since the chunker started recording it,
	 * and finding page 4 was still the researcher's job. The passage text goes
	 * along as the quote so the reader marks the sentence itself rather than
	 * dropping the reader at the top of a dense page (#37).
	 */
	function showSource() {
		void showInPdf({
			sha256: sentenceMetadata.sha256,
			page: sentenceMetadata.page_start ?? 1,
			selector: { quote: sentenceMetadata.sentence }
		});
	}

	// Helper to determine similarity score color
	function getSimilarityColor(score: number): string {
		if (score >= 0.8) return 'bg-surface-sunken text-success';
		if (score >= 0.6) return 'bg-surface-sunken text-success';
		if (score >= 0.4) return 'bg-surface-sunken text-warning';
		if (score >= 0.2) return 'bg-accent-quiet text-ink';
		return 'bg-surface-sunken text-danger';
	}

	/*
	 * Derived, not captured once.
	 *
	 * The results list reuses card instances between searches, so a plain
	 * `const` read at init left the score, its colour and the DOI link showing
	 * the *previous* search's match while the title and sentence beside them
	 * updated. The score is what the researcher judges relevance by, and the
	 * link would have opened the wrong paper.
	 */
	const similarityColor = $derived(getSimilarityColor(sentenceMetadata.similarity));
	const scorePercentage = $derived(Math.round(sentenceMetadata.similarity * 100));

	const sourceUrl = $derived(
		sentenceMetadata.metadata.DOI ? `https://doi.org/${sentenceMetadata.metadata.DOI}` : null
	);
	const needsExpander = $derived(sentenceMetadata.sentence.length > 120);
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
			class="bg-accent text-accent-ink hover:bg-accent-hover flex items-center space-x-1 rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60"
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

		{#if sentenceMetadata.page_start}
			<button
				class="bg-surface-sunken text-ink hover:bg-surface-hover flex items-center space-x-1 rounded px-3 py-1.5 text-xs font-medium transition-colors"
				onclick={showSource}
				title="Open the paper at this passage"
			>
				<Icon icon="BookOpen" size="s" />
				<span class="ml-1">Show in PDF</span>
			</button>
		{/if}

		{#if sourceUrl}
			<!-- sourceUrl is an external DOI or publisher link from the source metadata,
			     not SvelteKit navigation, so resolve() does not apply. -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<a
				href={sourceUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="bg-surface-sunken text-ink hover:bg-surface-hover flex items-center space-x-1 rounded px-3 py-1.5 text-xs font-medium transition-colors"
			>
				<Icon icon="ExternalLink" size="s" />
				<span class="ml-1">View online</span>
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
	</div>
</div>
