<script lang="ts">
	import { onMount } from 'svelte';

  import {dbStore} from '$lib/stores/db';
	import type { CitationItem } from '$lib/stores/citationStore';
	import SourceSidebar from './SourceSidebar.svelte';
	import { Icon } from '$lib';
	import { augmentSchema } from './adapterCslZotero';
	import type { AugmentedZoteroSchema } from './adapterCslZotero';

  const { executeQuery } = dbStore;
  
	type Source = {
		id: number;
		file_name: string;
		metadata: CitationItem;
	};

	let sources: Source[] = $state([]);
	let editingSource: CitationItem | null = $state(null);

	let loading = $state(true);
	let searchQuery = $state('');
	let selectedSourceId: number | null = $state(null);
	let sidebarOpen = $state(false);
	let augmentedSchema: AugmentedZoteroSchema | null = $state(null);

	onMount(async () => {
		augmentedSchema = await augmentSchema()
		await loadSources();		
		loading = false;
	});
	async function loadSources() {
		let files = (await executeQuery(`
	           SELECT
	             files.id, files.file_name, sm.metadata
	           FROM
	             files
	           LEFT JOIN
	             source_metadata sm ON files.id = sm.file_id
	       `)) as {
			id: number;
			file_name: string;
			metadata: string;
		}[];

		sources = files.map((file) => {
			// TODO: check if the metadata type is present or not. We could try to fetch data from online again
			// if we know the type determine zotero type from it and save it to db
			return {
				...file,
				metadata: JSON.parse(file.metadata)
			};
		});
	}


	function getAuthorDisplay(source: Source) {
		if (!source.metadata) return null;
		const authors = source.metadata.author;
		if (authors && authors.length > 0) {
			return `${authors[0].family}, ${authors[0].given}`;
		}

		return null;
	}

	function handleSourceSelect(sourceId: number) {
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

	async function handleSourceUpdate(sourceId: number, metadata: CitationItem) {
		await executeQuery(
			`INSERT OR REPLACE INTO source_metadata (file_id, metadata, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
			[sourceId, JSON.stringify(metadata)]
		);

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
