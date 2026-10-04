<script lang="ts">
	import { onMount } from 'svelte';

	import FileWarning from '~icons/lucide/file-warning';

	import { projectSources } from '$lib/stores/db';
	import { applyManualDoi, retryIngest } from '$utils/pdf_handlers';
	import { errorToast, successToast } from '$lib/toast/Toast.svelte';
	import type { CitationItem } from '$lib/stores/citationStore';
	import { Banner, Button, EmptyState, Loader, Menu, SearchField, TextField } from '$lib/ui';
	import SourceSidebar from './SourceSidebar.svelte';
	import { augmentSchema } from './adapterCslZotero';
	import { describeAuthors, describeType } from './sourceRows';
	import type { AugmentedZoteroSchema } from './adapterCslZotero';
	import { log } from '$lib/log';

	type Source = {
		id: string;
		file_name: string;
		path: string | null;
		/** The hash of the file at `path`, which may be a PDF attached to the work. */
		file_sha256: string | null;
		/** Null when the source has not resolved to anything citable. */
		metadata: CitationItem | null;
		/** The Zotero kind, when it was recorded; older sources have none (M1b-5 AC-5). */
		zotero_type: string | null;
		state: 'pending' | 'ready' | 'failed';
		last_error: string | null;
		/** True when ingest succeeded but nothing could be resolved to cite. */
		unresolved: boolean;
	};

	let sources: Source[] = $state([]);

	let loading = $state(true);
	let searchQuery = $state('');
	/** The row being edited, or `new` while a source is being entered by hand. */
	let sidebar = $state<{ mode: 'edit'; id: string } | { mode: 'new' } | null>(null);
	const selectedSourceId = $derived(sidebar?.mode === 'edit' ? sidebar.id : null);
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
			log.error('Unreadable citation metadata; treating the source as unresolved.', error);
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
				file_sha256: source.file_sha256,
				metadata,
				zotero_type: source.zotero_type ?? null,
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
		if (!source.path || !source.file_sha256) {
			errorToast(`Erti no longer knows where ${source.file_name} is.`);
			return;
		}

		busyWith = source.id;
		try {
			// Under the file's own hash: the path may be a PDF attached to the work
			// (ADR 003), whose chunks and metadata must not land on the work's id.
			await retryIngest({
				sha256: source.file_sha256,
				path: source.path,
				file_name: source.file_name
			});
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

	const selected = $derived(sources.find((s) => s.id === selectedSourceId) ?? null);

	function handleSourceSelect(sourceId: string) {
		sidebar = { mode: 'edit', id: sourceId };
	}

	function closeSidebar() {
		sidebar = null;
	}

	async function afterChange() {
		sidebar = null;
		await loadSources();
	}

	const filteredSources = $derived.by(() => {
		return searchQuery
			? sources.filter(
					(s) =>
						(s.metadata?.title || s.file_name).toLowerCase().includes(searchQuery.toLowerCase()) ||
						(describeAuthors(s.metadata) || '').toLowerCase().includes(searchQuery.toLowerCase())
				)
			: sources;
	});
</script>

<div class="flex h-full w-full">
	<div class="bg-surface min-w-0 flex-grow overflow-auto p-4">
		<div class="mb-4 flex items-center gap-3">
			<h2 class="text-heading text-ink flex-1 font-semibold">Sources ({sources.length})</h2>
			<Menu
				label="Add"
				align="end"
				items={[
					{
						label: 'Enter details…',
						description: 'A book, chapter or page with no PDF',
						onSelect: () => (sidebar = { mode: 'new' })
					}
				]}
			/>
			<div class="w-64">
				<SearchField
					label="Search sources"
					hideLabel
					placeholder="Search sources"
					bind:value={searchQuery}
				/>
			</div>
		</div>

		<!--
			Failure has to be visible to be fixable. The old pipeline registered a
			file, failed silently and never offered it again.
		-->
		{#if needsAttention.length > 0}
			<div class="mb-4">
				<Banner tone="warning">
					<p class="font-medium">
						{needsAttention.length}
						{needsAttention.length === 1 ? 'source needs' : 'sources need'} attention
					</p>
					<div class="divide-line mt-1 divide-y">
						{#each needsAttention as source (source.id)}
							<div class="py-2">
								<div class="flex items-center justify-between gap-3">
									<div class="min-w-0">
										<div class="text-ink truncate font-medium">{source.file_name}</div>
										<div class="text-caption text-ink-muted">
											{#if source.state === 'failed'}
												{source.last_error ?? 'Could not be processed'}
											{:else}
												No citation details found
											{/if}
										</div>
									</div>

									<div class="flex shrink-0 gap-2">
										<Button
											size="sm"
											loading={busyWith === source.id}
											onclick={() => handleRetry(source)}
										>
											{busyWith === source.id ? 'Working…' : 'Retry'}
										</Button>
										<Button
											size="sm"
											onclick={() => {
												doiFor = doiFor === source.id ? null : source.id;
												doiInput = '';
											}}
										>
											Enter DOI
										</Button>
									</div>
								</div>

								{#if doiFor === source.id}
									<div class="mt-2 flex items-end gap-2">
										<div class="flex-1">
											<TextField
												label="DOI for {source.file_name}"
												hideLabel
												placeholder="10.1000/example or https://doi.org/…"
												bind:value={doiInput}
												onkeydown={(e) => e.key === 'Enter' && handleManualDoi(source)}
											/>
										</div>
										<Button
											variant="primary"
											disabled={busyWith === source.id || doiInput.trim().length === 0}
											onclick={() => handleManualDoi(source)}
										>
											Resolve
										</Button>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</Banner>
			</div>
		{/if}

		{#if loading}
			<div class="flex h-20 items-center justify-center"><Loader /></div>
		{:else if filteredSources.length === 0}
			<EmptyState
				message={searchQuery ? 'No sources match your search.' : 'No sources in this project yet.'}
				detail={searchQuery
					? undefined
					: 'Add PDFs to the project folder, or enter a source’s details by hand.'}
				action={searchQuery
					? { label: 'Clear the search', onclick: () => (searchQuery = '') }
					: undefined}
			/>
		{:else}
			<!--
				Table-like layout for sources.

				The header and the rows have to declare the same tracks. They did
				not: the header spanned 1+5+3+3 and the rows 5+3+3, so every column
				of data sat one grid column to the left of the heading naming it,
				and "Type" labelled nothing at all — the field was never rendered,
				though every resolved source carries one.
			-->
			<div
				class="text-caption text-ink-muted mb-2 grid grid-cols-12 gap-3 px-3 font-medium uppercase"
			>
				<div class="col-span-2">Type</div>
				<div class="col-span-4">Title</div>
				<div class="col-span-3">Author</div>
				<div class="col-span-3">File</div>
			</div>

			<div class="divide-line border-line divide-y rounded border">
				{#each filteredSources as source (source.id)}
					<!--
						A button rather than a div with a click handler: the row is the
						control, so it has to be reachable by keyboard and announced as
						something that can be activated. `text-left` and `w-full` keep the
						grid looking as it did.
					-->
					<button
						type="button"
						class="hover:bg-surface-hover text-small grid w-full cursor-pointer grid-cols-12 gap-3 px-3 py-3 text-left transition-colors"
						class:bg-accent-quiet={selectedSourceId === source.id}
						aria-current={selectedSourceId === source.id ? 'true' : undefined}
						onclick={() => handleSourceSelect(source.id)}
					>
						<div class="col-span-2 flex items-center">
							<span class="text-caption text-ink-muted truncate"
								>{describeType(source.metadata)}</span
							>
						</div>

						<div class="col-span-4 flex items-center">
							<div class="truncate">
								<span class="text-ink font-medium"
									>{source.metadata?.title || source.file_name}</span
								>
								{#if !source.metadata?.title}
									<FileWarning class="text-warning ml-1 inline size-3.5" aria-label="No title" />
								{/if}
							</div>
						</div>

						<div class="text-ink-muted col-span-3 flex items-center">
							<span class="truncate">{describeAuthors(source.metadata) || 'No author'}</span>
						</div>

						<!-- M1b-5 AC-4. Attaching one is M1b-7. -->
						<div class="text-caption text-ink-muted col-span-3 flex items-center">
							<span class="truncate">{source.path ? source.file_name : 'No file'}</span>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if sidebar && augmentedSchema && (sidebar.mode === 'new' || selected)}
		{#key sidebar.mode === 'new' ? 'new' : sidebar.id}
			<SourceSidebar
				schema={augmentedSchema}
				record={selected && sidebar.mode === 'edit'
					? {
							id: selected.id,
							title: selected.metadata?.title || selected.file_name,
							path: selected.path,
							csl: selected.metadata,
							zoteroType: selected.zotero_type
						}
					: undefined}
				onclose={closeSidebar}
				onsaved={afterChange}
				onremoved={afterChange}
			/>
		{/key}
	{/if}
</div>
