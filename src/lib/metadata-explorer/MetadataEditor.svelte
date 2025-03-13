<script lang="ts">
	import { readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
	import { selectQuery } from '$utils/db';
	import type { CitationItem } from '$lib/stores/citationStore';
	import SourceSidebar from './SourceSidebar.svelte';
	import { Icon } from '$lib';
	// TODO: Implement more visual guides for users
	// ** for example when hovering on item in metadataeditor higlight the file in the file Explorer
	// ** or when user clicks on file in the explorer highligh item listing in the source
	// import { currentFileStore } from '$lib/stores/openFileStore';
	// import { fileSystemStore } from '$lib/stores/fileSystem';
	
	type Source = {
		id: number;
		file_name: string;
		metadata: CitationItem;
	};
	let sources: Source[] = [];
	let loading = true;
	let searchQuery = '';
	let selectedSourceId: number | null = null;
	let sidebarOpen = false;
	let schema: any = null;

	onMount(async () => {
		await Promise.all([loadSources(), loadSchema()]);

		loading = false;
	});
	async function loadSources() {
		let files = (await selectQuery(`
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
		sources = files.map((file) => ({
			id: file.id,
			file_name: file.file_name,
			metadata: JSON.parse(file.metadata)
		}));
	}

	async function loadSchema() {
		// Schema was fetched from https://api.zotero.org/schema
		// current version 33
		const schemaJson = await readTextFile('resources/csl/schema.json', {
			baseDir: BaseDirectory.Resource
		});
		schema = JSON.parse(schemaJson);
	}

	function getAuthorDisplay(source: Source) {
		if (!source.metadata) return null;
		const authors = source.metadata.author;
		if (authors && authors.length > 0) {
			return `${authors[0].family}, ${authors[0].given}`;
		}

		return null;
	}

	function getTypeIcon(type: string | null) {
		if (!type) return 'FileQuestion';

		const typeIconMap = {
			book: 'BookOpen',
			journalArticle: 'ScrollText',
			report: 'FileSpreadsheet',
			webpage: 'Globe',
			thesis: 'GraduationCap',
			presentation: 'Presentation',
			video: 'Video'
		};

		return typeIconMap[type] || 'File';
	}

	function getTypeClass(type: string | null) {
		if (!type) return 'text-gray-400';

		const typeColorMap = {
			book: 'text-blue-500',
			journalArticle: 'text-green-500',
			report: 'text-amber-500',
			webpage: 'text-purple-500',
			thesis: 'text-indigo-500'
		};

		return typeColorMap[type] || 'text-gray-500';
	}
	function handleSourceSelect(sourceId: number) {
		selectedSourceId = sourceId;
		sidebarOpen = true;
	}

	function handleSidebarClose() {
		sidebarOpen = false;
		// Optionally, after a delay, unselect the source
		// setTimeout(() => selectedSourceId = null, 300);
	}
	async function handleSourceUpdate(
		event: CustomEvent<{ sourceId: number; metadata: CitationItem }>
	) {
		const { sourceId, metadata } = event.detail;

		// Update the source in the local array
		sources = sources.map((source) => (source.id === sourceId ? { ...source, metadata } : source));

		// Update in the database
		// TODO: Implement database update logic
		// await executeQuery(
		// 	`UPDATE source_metadata SET metadata = ? WHERE file_id = ?`,
		// 	[JSON.stringify(metadata), sourceId]
		// );
	}

	$: filteredSources = searchQuery
		? sources.filter(
				(s) =>
					(s.metadata?.title || s.file_name).toLowerCase().includes(searchQuery.toLowerCase()) ||
					(getAuthorDisplay(s) || '').toLowerCase().includes(searchQuery.toLowerCase())
			)
		: sources;

	$: selectedSource = sources.find((s) => s.id === selectedSourceId) || null;
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
						on:click={() => handleSourceSelect(source.id)}
					>
						<!-- Type icon -->
						<div class="col-span-1 flex items-center">
							<div class={`${getTypeClass(source.metadata?.type)}`}>
								<Icon icon={getTypeIcon(source.metadata?.type)} class="h-5 w-5" />
							</div>
						</div>

						<!-- Title -->
						<div class="col-span-5 flex items-center">
							<div class="truncate">
								<span class="font-medium">{source.metadata?.title || source.file_name}</span>
								{#if !source.metadata?.title}
									<Icon icon="AlertCircle" class="ml-1 inline h-3.5 w-3.5 text-amber-500" />
								{/if}
							</div>
						</div>

						<!-- Author -->
						<div class="col-span-3 flex items-center text-sm text-gray-600">
							{#if getAuthorDisplay(source)}
								<span class="truncate">{getAuthorDisplay(source)}</span>
							{:else}
								<span class="flex items-center text-xs text-gray-400">
									<Icon icon="AlertCircle" class="mr-1 inline h-3.5 w-3.5 text-amber-500" />
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
	{#if schema}
		<SourceSidebar
			bind:open={sidebarOpen}
			source={selectedSource}
			{schema}
			on:close={handleSidebarClose}
			on:update={handleSourceUpdate}
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
