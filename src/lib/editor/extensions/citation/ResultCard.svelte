<script lang="ts">
	import type { CitationItem } from '$lib/stores/citationStore';
	import { Icon } from '$lib';
	import { Button, Item } from '$lib/ui';
	import { buttonClass } from '$lib/ui/Button.svelte';
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

	/**
	 * Open the paper at this passage.
	 *
	 * The card has said "p. 4 · Results" since the chunker started recording it,
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
</script>

<!--
	Where the passage is, which is what Phase 2 recorded page and section for:
	"p. 4 · Results" is what lets a researcher check a quotation against the PDF.
	Given to the row only when there's something to say, so a passage with
	neither draws no empty line.
-->
{#snippet meta()}
	{#if sentenceMetadata.page_start}<span>p. {sentenceMetadata.page_start}</span>{/if}
	{#if sentenceMetadata.section}
		<span class="truncate">
			{sentenceMetadata.page_start ? '· ' : ''}{sentenceMetadata.section}
		</span>
	{/if}
{/snippet}

<Item
	title={sentenceMetadata.metadata.title}
	quote={sentenceMetadata.sentence}
	clamp
	meta={sentenceMetadata.page_start || sentenceMetadata.section ? meta : undefined}
>
	{#snippet leading()}
		<!-- The score is what the researcher judges relevance by. -->
		<span
			class={[
				'text-caption grid size-9 shrink-0 place-items-center rounded font-semibold tabular-nums',
				similarityColor
			]}
		>
			{scorePercentage}%
		</span>
	{/snippet}

	{#snippet actions()}
		<!--
			A source from outside the project says so, because citing it changes the
			project: it joins this project's sources. Adding silently would leave the
			researcher unsure which papers a project actually contains.
		-->
		<Button
			variant="primary"
			size="sm"
			class="ml-2"
			onclick={oncite}
			loading={busy}
			title={sentenceMetadata.in_project === false
				? 'Add this source to the project and cite it'
				: 'Cite this source'}
		>
			{#if !busy}<Icon icon="Quote" size="s" />{/if}
			{#if busy}
				Adding…
			{:else if sentenceMetadata.in_project === false}
				Add &amp; cite
			{:else}
				Cite
			{/if}
		</Button>

		{#if sentenceMetadata.page_start}
			<Button variant="ghost" size="sm" onclick={showSource} title="Open the paper at this passage">
				<Icon icon="BookOpen" size="s" />
				Show in PDF
			</Button>
		{/if}

		{#if sourceUrl}
			<!-- sourceUrl is an external DOI or publisher link from the source metadata,
			     not SvelteKit navigation, so resolve() does not apply. -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<a
				href={sourceUrl}
				target="_blank"
				rel="noopener noreferrer"
				class={[
					buttonClass({ variant: 'ghost', size: 'sm' }),
					// The variant's hover is `enabled:`, which a link never is.
					'hover:bg-surface-hover hover:text-ink'
				]}
			>
				<Icon icon="ExternalLink" size="s" />
				View online
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
	{/snippet}
</Item>
