<script lang="ts">
	import { fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import ResultCard from './ResultCard.svelte';
	import { Loader } from '$lib';

	import { addToProject, searchSources, type ScoredChunk } from '$lib/stores/db';
	import { citationStore } from '$lib/stores/citationStore';
	import { errorToast } from '$lib/toast/Toast.svelte';

	import type { CitationItem } from '$lib/stores/citationStore';
	import { clickOutside } from '$utils/clickOutside.svelte';

	interface Props {
		selectedText: string;
		closePanel: () => void;
		selectCitation: (citation: { id: string; inlineCitation: string }) => void;
	}

	let { selectedText, closePanel, selectCitation }: Props = $props();

	type Match = ScoredChunk & { sentence: string; id: string; metadata: CitationItem };

	/** Widen past the project's own sources into the rest of the library. */
	let includeLibrary = $state(false);

	/**
	 * Embedding, cosine and ranking all happen in Rust now.
	 *
	 * This used to SELECT every chunk and its embedding, pull the whole corpus
	 * across the IPC boundary, JSON.parse each 384-float array and score them on
	 * the main thread. Only the top results cross now.
	 */
	async function search(includeWiderLibrary: boolean): Promise<Match[]> {
		const chunks = await searchSources(selectedText, {
			limit: 5,
			includeLibrary: includeWiderLibrary
		});

		const citationSources = citationStore.getAllSourcesAsJson();

		return chunks.map((chunk) => ({
			...chunk,
			sentence: chunk.text,
			id: chunk.sha256,
			// A source found outside the project has no citation entry loaded yet;
			// adding it to the project is what makes it citable.
			metadata: citationSources[chunk.sha256] ?? {
				id: chunk.sha256,
				type: 'article-journal',
				title: 'Unknown Title'
			}
		}));
	}

	/** Set while a library source is being added, so the click cannot repeat. */
	let adding = $state<string | null>(null);

	/**
	 * Cite a match, adding it to the project first if it came from elsewhere.
	 *
	 * This is what makes the wider library useful rather than merely visible: a
	 * paper read for another project is cited in one action, with no copying and
	 * no re-embedding, because its chunks are already in the library.
	 *
	 * The order matters. The source has to be in the project *and* loaded into
	 * the citation engine before the citation is inserted, or the document render
	 * finds no source behind the id and shows it as removed.
	 */
	async function cite(match: Match) {
		if (adding) return;

		try {
			if (!match.in_project) {
				adding = match.sha256;
				await addToProject(match.sha256);
				// Reloaded so citeproc knows the source. Without this the citation
				// inserts against an id the engine cannot resolve.
				await citationStore.initializeCitationStore();
			}

			// A source can be searchable without being citable: ingest stores its
			// chunks whether or not the metadata resolved, and only resolved sources
			// reach the citation engine. Inserting anyway would put an empty
			// citation in the manuscript that renders as a removed source — so the
			// user is told what to do instead, and the source stays in the project
			// where the metadata can be added.
			if (!citationStore.getAllSourcesAsJson()[match.sha256]) {
				errorToast(
					`That source has no citation details yet, so it cannot be cited. It has been added to this project — open the metadata explorer to paste a DOI or enter the details.`
				);
				return;
			}

			selectCitation({
				id: JSON.stringify([match.sha256]),
				inlineCitation: citationStore.previewCitation([match.sha256])
			});
		} catch (error) {
			console.error('Could not cite that source:', error);
			errorToast(
				`Could not add that source to this project: ${error instanceof Error ? error.message : String(error)}`
			);
		} finally {
			adding = null;
		}
	}

	const results = $derived(search(includeLibrary));
</script>

<div
	class="results-wrapper"
	transition:fly={{ delay: 0, duration: 500, x: 100, y: 0, easing: quintOut }}
	use:clickOutside
	onoutclick={closePanel}
>
	<h3 class="p-4">
		{includeLibrary ? 'Matches across your library' : 'Matches in this project'}
	</h3>
	{#await results}
		<div class="flex h-[50%] w-[100%] flex-col items-center justify-center">
			<p class="p-4">Searching for citation:</p>
			<Loader />
		</div>
	{:then matches}
		{#if matches.length > 0}
			{#each matches as match, i (i)}
				<ResultCard
					sentenceMetadata={match}
					oncite={() => cite(match)}
					busy={adding === match.sha256}
				/>
			{/each}
		{:else}
			<p class="p-4">
				{includeLibrary ? 'No results found' : 'Nothing in this project matches'}
			</p>
		{/if}

		<!--
			The project's own sources are searched first. Everything else read for
			any project stays one click away, rather than being invisible.
		-->
		{#if !includeLibrary}
			<button
				class="border-line-strong hover:bg-surface-sunken m-4 rounded-md border px-3 py-2 text-sm"
				onclick={() => (includeLibrary = true)}
			>
				Search the rest of my library
			</button>
		{:else}
			<button
				class="text-ink-muted hover:bg-surface-sunken m-4 rounded-md px-3 py-2 text-sm"
				onclick={() => (includeLibrary = false)}
			>
				Only this project
			</button>
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
