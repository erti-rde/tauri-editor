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
		/** Null when the source has not resolved to anything citable. */
		metadata: CitationItem | null;
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
		try {
			augmentedSchema = await augmentSchema();
			await loadSources();
		} catch (error) {
			// Leaving `loading` true would strand the panel on its spinner.
			errorToast(error instanceof Error ? error.message : String(error));
		} finally {
			loading = false;
		}
	});
	/** An unreadable value is treated as unresolved rather than failing the load. */
	function parseCsl(cslJson: string | null): CitationItem | null {
		if (!cslJson) return null;
		try {
			return JSON.parse(cslJson) as CitationItem;
		} catch (error) {
			console.error('Unreadable citation metadata; treating the source as unresolved.', error);
			return null;
		}
	}

	async function loadSources() {
		sources = (await projectSources()).map((source) => {
			// Unresolved sources have no CSL-JSON yet; the row still lists so the
			// user can see what failed and fix it, rather than it vanishing.
			const metadata = parseCsl(source.csl_json);

			return {
				id: source.sha256,
				file_name: source.file_name,
				path: source.path,
				metadata,
				state: source.state,
				last_error: source.last_error,
				unresolved: metadata === null
			};
		});
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
		// Validated here rather than only in the template: the Enter-key path
		// applied neither guard, so it could fire on an empty input or start a
		// second concurrent resolve.
		if (busyWith === source.id) return;
		const doi = doiInput.trim();
		if (!doi) return;

		busyWith = source.id;
		try {
			const metadata = await applyManualDoi(source.id, doi);
			successToast(`Resolved: ${metadata.title ?? source.file_name}`);
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
			// A copy: SourceSidebar takes this as $bindable() and mutates fields in
			// place, which would otherwise edit the loaded list as the user types,
			// before anything is saved.
			editingSource = source.metadata
				? (structuredClone($state.snapshot(source.metadata)) as CitationItem)
				: ({ id: source.id, type: '' } as CitationItem);
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
		class="bg-surface-raised flex-grow overflow-auto rounded-lg p-4 shadow {sidebarOpen
			? 'mr-[400px]'
			: ''}"
	>
		<!-- Header with search -->
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-xl font-bold">Sources ({sources.length})</h2>

			<div class="relative max-w-md">
				<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
					<Icon icon="Search" class="text-ink-faint h-4 w-4" />
				</div>
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search sources..."
					class="border-line-strong bg-surface-raised focus:border-accent focus:ring-accent block w-full rounded-md border py-2 pr-3 pl-10 text-sm placeholder-gray-400 focus:ring-1 focus:outline-none"
				/>
			</div>
		</div>

		<!--
			Failure has to be visible to be fixable. The old pipeline registered a
			file, failed silently and never offered it again.
		-->
		{#if needsAttention.length > 0}
			<div class="border-warning bg-surface-sunken mb-4 rounded-lg border p-4">
				<div class="mb-2 flex items-center gap-2">
					<Icon icon="FileWarning" class="text-warning h-4 w-4" />
					<span class="text-warning font-medium">
						{needsAttention.length}
						{needsAttention.length === 1 ? 'source needs' : 'sources need'} attention
					</span>
				</div>

				<div class="divide-line divide-y">
					{#each needsAttention as source (source.id)}
						<div class="py-2">
							<div class="flex items-center justify-between gap-3">
								<div class="min-w-0">
									<div class="text-ink truncate text-sm font-medium">{source.file_name}</div>
									<div class="text-warning text-xs">
										{#if source.state === 'failed'}
											{source.last_error ?? 'Could not be processed'}
										{:else}
											No citation details found
										{/if}
									</div>
								</div>

								<div class="flex shrink-0 gap-2">
									<button
										class="hover:bg-surface-sunken border-warning text-warning rounded-md border px-3 py-1 text-sm disabled:opacity-50"
										disabled={busyWith === source.id}
										onclick={() => handleRetry(source)}
									>
										{busyWith === source.id ? 'Working…' : 'Retry'}
									</button>
									<button
										class="hover:bg-surface-sunken border-warning text-warning rounded-md border px-3 py-1 text-sm"
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
										class="border-line-strong focus:border-accent focus:ring-accent flex-1 rounded-md border px-3 py-1 text-sm focus:ring-1 focus:outline-none"
										onkeydown={(e) => e.key === 'Enter' && handleManualDoi(source)}
									/>
									<button
										class="bg-accent text-accent-ink hover:bg-accent rounded-md px-3 py-1 text-sm font-medium disabled:opacity-50"
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
				<div class="text-ink-faint animate-pulse">Loading sources...</div>
			</div>
		{:else if filteredSources.length === 0}
			<div class="bg-surface-sunken rounded-lg p-4 text-center">
				<p class="text-ink-muted">
					{searchQuery ? 'No sources match your search' : 'No sources found in the database'}
				</p>
			</div>
		{:else}
			<!-- Table-like layout for sources -->
			<div class="text-ink-muted mb-2 grid grid-cols-12 gap-3 px-3 text-xs font-medium uppercase">
				<div class="col-span-1">Type</div>
				<div class="col-span-5">Title</div>
				<div class="col-span-3">Author</div>
				<div class="col-span-3">File</div>
			</div>

			<div class="divide-line border-line divide-y rounded-lg border">
				{#each filteredSources as source (source.id)}
					<!--
						A button rather than a div with a click handler: the row is the
						control, so it has to be reachable by keyboard and announced as
						something that can be activated. `text-left` and `w-full` keep the
						grid looking as it did.
					-->
					<button
						type="button"
						class="hover:bg-surface-sunken grid w-full cursor-pointer grid-cols-12 gap-3 px-3 py-3 text-left transition-colors"
						class:bg-accent-quiet={selectedSourceId === source.id}
						aria-current={selectedSourceId === source.id ? 'true' : undefined}
						onclick={() => handleSourceSelect(source.id)}
					>
						<!-- Title -->
						<div class="col-span-5 flex items-center">
							<div class="truncate">
								<span class="font-medium">{source.metadata?.title || source.file_name}</span>
								{#if !source.metadata?.title}
									<Icon icon="FileWarning" class="text-warning ml-1 inline h-3.5 w-3.5" />
								{/if}
							</div>
						</div>

						<!-- Author -->
						<div class="text-ink-muted col-span-3 flex items-center text-sm">
							{#if getAuthorDisplay(source)}
								<span class="truncate">{getAuthorDisplay(source)}</span>
							{:else}
								<span class="text-ink-faint flex items-center text-xs">
									<span>No author</span>
								</span>
							{/if}
						</div>

						<!-- Filename -->
						<div class="text-ink-muted col-span-3 flex items-center text-xs">
							<span class="truncate">{source.file_name}</span>
						</div>
					</button>
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
