<script lang="ts">
	import { onMount } from 'svelte';

	import { projectSources, setMetadataOverride } from '$lib/stores/db';
	import { applyManualDoi, retryIngest } from '$utils/pdf_handlers';
	import { errorToast, successToast } from '$lib/toast/Toast.svelte';
	import type { CitationItem } from '$lib/stores/citationStore';
	import SourceSidebar from './SourceSidebar.svelte';
	import { Icon } from '$lib';
	import { augmentSchema } from './adapterCslZotero';
	import type { AugmentedZoteroSchema } from './adapterCslZotero';

	type Source = {
		id: string;
		file_name: string;
		path: string | null;
		metadata: CitationItem;
		state: 'pending' | 'ready' | 'failed';
		last_error: string | null;
		/** True when ingest succeeded but nothing could be resolved to cite. */
		unresolved: boolean;
	};

	let sources: Source[] = $state([]);
	let editingSource: CitationItem | null = $state(null);

	let loading = $state(true);
	let searchQuery = $state('');
	let selectedSourceId: string | null = $state(null);
	let sidebarOpen = $state(false);
	let augmentedSchema: AugmentedZoteroSchema | null = $state(null);

	onMount(async () => {
		augmentedSchema = await augmentSchema();
		await loadSources();
		loading = false;
	});
	async function loadSources() {
		sources = (await projectSources()).map((source) => ({
			id: source.sha256,
			file_name: source.file_name,
			path: source.path,
			// Unresolved sources have no CSL-JSON yet; the row still lists so the
			// user can see what failed and fix it, rather than it vanishing.
			metadata: source.csl_json ? JSON.parse(source.csl_json) : {},
			state: source.state,
			last_error: source.last_error,
			unresolved: !source.csl_json
		}));
	}

	/**
	 * Sources that need a human.
	 *
	 * Failure used to be invisible — 41% of the old corpus sat unprocessed with
	 * nothing in the interface to say so. Anything that failed to ingest, or
	 * ingested but resolved to nothing citable, is surfaced here.
	 */
	const needsAttention = $derived(sources.filter((s) => s.state === 'failed' || s.unresolved));

	let busyWith: string | null = $state(null);
	let doiFor: string | null = $state(null);
	let doiInput = $state('');

	async function handleRetry(source: Source) {
		if (!source.path) {
			errorToast(`Erti no longer knows where ${source.file_name} is.`);
			return;
		}

		busyWith = source.id;
		try {
			await retryIngest({ sha256: source.id, path: source.path, file_name: source.file_name });
			await loadSources();
		} catch (error) {
			errorToast(error instanceof Error ? error.message : String(error));
		} finally {
			busyWith = null;
		}
	}

	async function handleManualDoi(source: Source) {
		busyWith = source.id;
		try {
			const metadata = await applyManualDoi(source.id, doiInput);
			successToast(`Resolved: ${metadata.title}`);
			doiFor = null;
			doiInput = '';
			await loadSources();
		} catch (error) {
			errorToast(error instanceof Error ? error.message : String(error));
		} finally {
			busyWith = null;
		}
	}

	function getAuthorDisplay(source: Source) {
		if (!source.metadata) return null;
		const authors = source.metadata.author;
		if (authors && authors.length > 0) {
			return `${authors[0].family}, ${authors[0].given}`;
		}

		return null;
	}

	function handleSourceSelect(sourceId: string) {
		selectedSourceId = sourceId;
		const source = sources.find((s) => s.id === sourceId);
		if (source) {
			editingSource = source.metadata;
			if (source.file_name) {
				editingSource.id = source.id;
			}
		} else {
			editingSource = null;
		}

		sidebarOpen = true;
	}

	function handleSidebarClose() {
		sidebarOpen = false;
		editingSource = null;
	}

	async function handleSourceUpdate(sourceId: string, metadata: CitationItem) {
		// Written as a project-local override, so correcting a source here does
		// not silently rewrite it for every other project citing the same paper.
		await setMetadataOverride(sourceId, JSON.stringify(metadata));
		await loadSources();

		editingSource = null;
		sidebarOpen = false;
	}

	const filteredSources = $derived.by(() => {
		return searchQuery
			? sources.filter(
					(s) =>
						(s.metadata?.title || s.file_name).toLowerCase().includes(searchQuery.toLowerCase()) ||
						(getAuthorDisplay(s) || '').toLowerCase().includes(searchQuery.toLowerCase())
				)
			: sources;
	});
</script>

<div class="flex h-full w-full">
	<div
		class="flex-grow overflow-auto rounded-lg bg-white p-4 shadow {sidebarOpen ? 'mr-[400px]' : ''}"
	>
		<!-- Header with search -->
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-xl font-bold">Sources ({sources.length})</h2>

			<div class="relative max-w-md">
				<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
					<Icon icon="Search" class="h-4 w-4 text-gray-400" />
				</div>
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search sources..."
					class="block w-full rounded-md border border-gray-300 bg-white py-2 pr-3 pl-10 text-sm placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
				/>
			</div>
		</div>

		<!--
			Failure has to be visible to be fixable. The old pipeline registered a
			file, failed silently and never offered it again.
		-->
		{#if needsAttention.length > 0}
			<div class="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
				<div class="mb-2 flex items-center gap-2">
					<Icon icon="FileWarning" class="h-4 w-4 text-amber-600" />
					<span class="font-medium text-amber-900">
						{needsAttention.length}
						{needsAttention.length === 1 ? 'source needs' : 'sources need'} attention
					</span>
				</div>

				<div class="divide-y divide-amber-200">
					{#each needsAttention as source (source.id)}
						<div class="py-2">
							<div class="flex items-center justify-between gap-3">
								<div class="min-w-0">
									<div class="truncate text-sm font-medium text-gray-800">{source.file_name}</div>
									<div class="text-xs text-amber-700">
										{#if source.state === 'failed'}
											{source.last_error ?? 'Could not be processed'}
										{:else}
											No citation details found
										{/if}
									</div>
								</div>

								<div class="flex shrink-0 gap-2">
									<button
										class="rounded-md border border-amber-400 px-3 py-1 text-sm text-amber-900 hover:bg-amber-100 disabled:opacity-50"
										disabled={busyWith === source.id}
										onclick={() => handleRetry(source)}
									>
										{busyWith === source.id ? 'Working…' : 'Retry'}
									</button>
									<button
										class="rounded-md border border-amber-400 px-3 py-1 text-sm text-amber-900 hover:bg-amber-100"
										onclick={() => {
											doiFor = doiFor === source.id ? null : source.id;
											doiInput = '';
										}}
									>
										Enter DOI
									</button>
								</div>
							</div>

							{#if doiFor === source.id}
								<div class="mt-2 flex gap-2">
									<input
										type="text"
										bind:value={doiInput}
										placeholder="10.1000/example or https://doi.org/…"
										class="flex-1 rounded-md border border-gray-300 px-3 py-1 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 focus:outline-none"
										onkeydown={(e) => e.key === 'Enter' && handleManualDoi(source)}
									/>
									<button
										class="rounded-md bg-orange-500 px-3 py-1 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
										disabled={busyWith === source.id || doiInput.trim().length === 0}
										onclick={() => handleManualDoi(source)}
									>
										Resolve
									</button>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if loading}
			<div class="flex h-20 items-center justify-center">
				<div class="animate-pulse text-gray-400">Loading sources...</div>
			</div>
		{:else if filteredSources.length === 0}
			<div class="rounded-lg bg-gray-50 p-4 text-center">
				<p class="text-gray-500">
					{searchQuery ? 'No sources match your search' : 'No sources found in the database'}
				</p>
			</div>
		{:else}
			<!-- Table-like layout for sources -->
			<div class="mb-2 grid grid-cols-12 gap-3 px-3 text-xs font-medium text-gray-500 uppercase">
				<div class="col-span-1">Type</div>
				<div class="col-span-5">Title</div>
				<div class="col-span-3">Author</div>
				<div class="col-span-3">File</div>
			</div>

			<div class="divide-y divide-gray-100 rounded-lg border border-gray-200">
				{#each filteredSources as source (source.id)}
					<div
						class="grid cursor-pointer grid-cols-12 gap-3 px-3 py-3 transition-colors hover:bg-gray-50"
						class:bg-blue-50={selectedSourceId === source.id}
						onclick={() => handleSourceSelect(source.id)}
					>
						<!-- Title -->
						<div class="col-span-5 flex items-center">
							<div class="truncate">
								<span class="font-medium">{source.metadata?.title || source.file_name}</span>
								{#if !source.metadata?.title}
									<Icon icon="FileWarning" class="ml-1 inline h-3.5 w-3.5 text-amber-500" />
								{/if}
							</div>
						</div>

						<!-- Author -->
						<div class="col-span-3 flex items-center text-sm text-gray-600">
							{#if getAuthorDisplay(source)}
								<span class="truncate">{getAuthorDisplay(source)}</span>
							{:else}
								<span class="flex items-center text-xs text-gray-400">
									<span>No author</span>
								</span>
							{/if}
						</div>

						<!-- Filename -->
						<div class="col-span-3 flex items-center text-xs text-gray-500">
							<span class="truncate">{source.file_name}</span>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Sidebar for editing source -->
	{#if sidebarOpen && editingSource && augmentedSchema}
		<SourceSidebar
			bind:source={editingSource}
			{augmentedSchema}
			onclose={handleSidebarClose}
			onupdate={handleSourceUpdate}
		/>
	{/if}
</div>

<style>
	/* Ensure truncated text has ellipsis */
	.truncate {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
