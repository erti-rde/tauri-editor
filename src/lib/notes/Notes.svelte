<script lang="ts">
	import { onMount } from 'svelte';

	import Icon from '$lib/icon/Icon.svelte';
	import Loader from '$lib/loader/Loader.svelte';
	import { annotationsStore, pageLabelOf } from '$lib/stores/annotations.svelte';
	import {
		allAnnotations,
		embedPendingAnnotations,
		searchAnnotations,
		type ScoredAnnotation
	} from '$lib/stores/db';
	import { showInPdf } from '$lib/pdfreader/showInPdf';
	import { save } from '@tauri-apps/plugin-dialog';
	import { writeTextFile } from '@tauri-apps/plugin-fs';
	import { projectSources } from '$lib/stores/db';
	import { errorToast, successToast } from '$lib/toast/Toast.svelte';
	import { toMarkdown, toSidecar } from './export';
	import { draftContext, draftMatches } from './draftContext';
	import { log } from '$lib/log';

	/**
	 * Everything marked, across every paper.
	 *
	 * The reader's own sidebar answers "what did I find in this paper". This
	 * answers the other question — "where did I write something about this idea"
	 * — which is the one that matters while drafting, and which nothing in Erti
	 * could answer before: a note taken last year for another project was, in
	 * practice, lost.
	 *
	 * Results put the open project first and the wider library after, the same
	 * ordering the citation search uses, so the two surfaces behave alike.
	 */

	let query = $state('');
	let semantic = $state(false);

	/**
	 * Follow the writing when nothing has been typed here.
	 *
	 * This is the whole point of the panel while drafting: the notes you already
	 * made about an idea, beside the sentence that is about it. It never
	 * interrupts and never speaks — it is simply there, and you look when you
	 * want to. Typing a query takes over, because an explicit question beats a
	 * guess at one.
	 */
	let following = $state(true);
	let followed = $state('');
	let results = $state<ScoredAnnotation[]>([]);
	let loading = $state(false);
	let ran = $state(false);

	/**
	 * What went wrong, said out loud.
	 *
	 * A search that threw used to set the results to nothing and log to a console
	 * nobody has open, so asking a question and getting an empty panel looked
	 * exactly like asking a question and being told there is no answer. Those are
	 * different things and the reader has to be able to tell them apart.
	 */
	let failure = $state<string | null>(null);

	/** A search by meaning found nothing, and there are marks it could not see. */
	let unprepared = $state(false);
	let preparing = $state(false);

	onMount(() => {
		void annotationsStore.loadLabels();
		void run();
	});

	/**
	 * Re-run whenever the writing moves on, unless a question has been typed.
	 *
	 * Guarded on the paragraph actually changing: the editor already waits for a
	 * pause before publishing, and repeating a search for text that has not
	 * changed would cost an embedding for nothing.
	 */
	$effect(() => {
		const paragraph = $draftContext.paragraph;
		if (!following || query.trim() || !paragraph || paragraph === followed) return;

		followed = paragraph;
		void run(paragraph);
	});

	async function run(context?: string) {
		loading = true;
		failure = null;
		unprepared = false;
		try {
			const asked = query.trim();
			const found = asked
				? await searchAnnotations(asked, { semantic, limit: 100 })
				: context
					? await searchAnnotations(context, { semantic: true, limit: 20 })
					: ((await allAnnotations({ limit: 100 })) as ScoredAnnotation[]);
			results = Array.isArray(found) ? found : [];
			ran = true;

			// A search by meaning matches against vectors, and a mark made while the
			// model was unavailable has none — so an empty answer here may mean
			// "nothing is about that" or "nothing has been prepared", and only one
			// of those is the reader's to solve.
			if (results.length === 0 && (semantic || context)) {
				const marks = await allAnnotations({ limit: 1 });
				unprepared = Array.isArray(marks) && marks.length > 0;
			}

			// Report back only for a search that followed the writing. A typed
			// query is the writer asking a question, and answering it should not
			// also put a mark in their margin.
			if (context && !asked) {
				draftMatches.set({
					paragraph: context,
					sources: results.map((row) => ({ sha256: row.sha256, similarity: row.similarity }))
				});
			}
		} catch (thrown) {
			// Before a project is open there is no library to ask, which is an
			// ordinary state for a panel that can be opened at any time — but it is
			// still said, because a panel that goes blank for two different reasons
			// cannot be acted on.
			log.error('Could not search the marks', thrown);
			results = [];
			ran = true;
			failure = thrown instanceof Error ? thrown.message : String(thrown);
		} finally {
			loading = false;
		}
	}

	/** Embed the marks that were never embedded, and ask again. */
	async function prepare() {
		preparing = true;
		try {
			const done = await embedPendingAnnotations();
			successToast(
				done === 0
					? 'Every note was already prepared.'
					: `Prepared ${done} ${done === 1 ? 'note' : 'notes'}.`
			);
			await run();
		} catch (thrown) {
			log.error('Could not prepare the notes', thrown);
			errorToast('Could not prepare the notes for searching by meaning.');
		} finally {
			preparing = false;
		}
	}

	const inProject = $derived(results.filter((row) => row.in_project !== false));
	const elsewhere = $derived(results.filter((row) => row.in_project === false));

	/**
	 * Write the notes out.
	 *
	 * Markdown for reading and pasting, JSON for keeping. Neither touches the
	 * PDFs: writing marks into a file would change its bytes, and the library is
	 * keyed on the hash of those bytes.
	 */
	async function exportNotes(format: 'md' | 'json') {
		try {
			const marks = await allAnnotations({ limit: 10_000 });
			if (!Array.isArray(marks) || marks.length === 0) {
				errorToast('There are no notes to export yet.');
				return;
			}

			let contents: string;
			if (format === 'json') {
				contents = toSidecar(marks);
			} else {
				const sources = await projectSources().catch(() => []);
				contents = toMarkdown(
					marks,
					sources.map((source) => ({
						sha256: source.sha256,
						title: titleOf(source.csl_json) ?? source.file_name
					})),
					$annotationsStore.labels
				);
			}

			const path = await save({
				defaultPath: format === 'json' ? 'notes.json' : 'notes.md',
				filters: [
					format === 'json'
						? { name: 'Erti notes', extensions: ['json'] }
						: { name: 'Markdown', extensions: ['md'] }
				]
			});
			if (!path) return;

			await writeTextFile(path, contents);
			successToast(`Wrote ${marks.length} notes.`);
		} catch (failure) {
			log.error('Could not export the notes', failure);
			errorToast('Could not write the notes out.');
		}
	}

	/** A paper's title from its CSL metadata, when it resolved. */
	function titleOf(cslJson: string | null): string | null {
		if (!cslJson) return null;
		try {
			const title = JSON.parse(cslJson)?.title;
			return typeof title === 'string' ? title : null;
		} catch {
			return null;
		}
	}

	function colourOf(labelId: string | null): string {
		return $annotationsStore.labels.find((label) => label.id === labelId)?.colour ?? '45 90% 60%';
	}

	function nameOf(labelId: string | null): string {
		return $annotationsStore.labels.find((label) => label.id === labelId)?.name ?? 'Highlight';
	}
</script>

<div class="flex h-full flex-col">
	<div class="border-line flex flex-col gap-2 border-b p-2">
		<div class="flex items-center gap-1">
			<input
				class="border-line bg-surface-sunken text-ink grow rounded border px-2 py-1 text-xs"
				placeholder="Search your notes…"
				aria-label="Search your notes"
				bind:value={query}
				onkeydown={(event) => {
					if (event.key === 'Enter') void run();
				}}
			/>
			<button
				class="text-ink-muted hover:bg-surface-hover rounded p-1"
				onclick={() => void run()}
				aria-label="Search"
			>
				<Icon icon="Search" size="s" />
			</button>
		</div>

		<!--
			Named for what it does rather than for what it is.
			
			"Follow what I am writing" described the mechanism and left the reader to
			work out the consequence — which is that with nothing typed here, the
			panel keeps showing notes about the paragraph the cursor is in. The
			second line says that outright, because a checkbox whose effect you have
			to discover by experiment is one you switch off.
		-->
		<label class="flex items-start gap-1.5 text-[11px]">
			<input
				type="checkbox"
				class="mt-0.5"
				bind:checked={following}
				onchange={() => {
					followed = '';
					if (!following) void run();
				}}
			/>
			<span>
				<span class="text-ink">Show notes about the paragraph I'm in</span>
				<span class="text-ink-muted block">
					Updates as you write, by meaning. Typing a search here takes over.
				</span>
			</span>
		</label>

		<!--
			Only meaningful for a typed question. Following the writing always
			searches by meaning — a paragraph is not a phrase to look for literally —
			so with nothing typed this control decides nothing, and saying so beats
			leaving it looking broken.
		-->
		<div
			class="flex items-center gap-1 text-[11px]"
			role="group"
			aria-label="How to search"
			aria-disabled={following && !query.trim()}
			class:opacity-50={following && !query.trim()}
		>
			<button
				class="rounded px-2 py-0.5 {semantic
					? 'text-ink-muted hover:bg-surface-hover'
					: 'bg-surface-active text-ink'}"
				aria-pressed={!semantic}
				onclick={() => {
					semantic = false;
					void run();
				}}>Words</button
			>
			<button
				class="rounded px-2 py-0.5 {semantic
					? 'bg-surface-active text-ink'
					: 'text-ink-muted hover:bg-surface-hover'}"
				aria-pressed={semantic}
				onclick={() => {
					semantic = true;
					void run();
				}}>Meaning</button
			>
		</div>

		<div class="text-ink-muted flex items-center gap-2 text-[11px]">
			<span>Export</span>
			<button class="hover:text-ink underline" onclick={() => void exportNotes('md')}>
				Markdown
			</button>
			<button class="hover:text-ink underline" onclick={() => void exportNotes('json')}>
				JSON
			</button>
		</div>
	</div>

	<div class="min-h-0 grow overflow-auto">
		{#if loading}
			<div class="flex justify-center p-6"><Loader /></div>
		{:else if failure}
			<!--
				Said, rather than shown as an empty list. A panel that goes blank when
				a search fails and blank when a search finds nothing gives the reader
				no way to tell which happened.
			-->
			<div class="p-3 text-xs">
				<p class="text-ink">That search could not be run.</p>
				<p class="text-ink-muted mt-1">{failure}</p>
				<p class="text-ink-muted mt-1">If no project is open yet, there is no library to search.</p>
			</div>
		{:else if results.length === 0 && unprepared}
			<!--
				The one empty answer the reader can do something about: marks exist,
				but they carry no vectors, so a search by meaning cannot see them.
				Embedding happens when a mark is made and can fail quietly — before a
				library is open, or while the model is loading.
			-->
			<div class="p-3 text-xs">
				<p class="text-ink">Nothing found by meaning.</p>
				<p class="text-ink-muted mt-1">
					Some of your notes have not been prepared for this yet, so searching by meaning cannot see
					them. Searching by words still works.
				</p>
				<button
					class="bg-accent text-accent-ink hover:bg-accent-hover mt-2 rounded px-2 py-1 text-[11px] font-medium disabled:opacity-60"
					disabled={preparing}
					onclick={() => void prepare()}
				>
					{preparing ? 'Preparing…' : 'Prepare my notes'}
				</button>
			</div>
		{:else if results.length === 0}
			<p class="text-ink-muted p-3 text-xs">
				{ran && query.trim()
					? 'Nothing matches that.'
					: 'Nothing marked yet. Highlight a passage while reading and it will appear here.'}
			</p>
		{:else}
			{#if following && !query.trim() && followed}
				<p class="text-ink-muted bg-surface-sunken border-line border-b px-3 py-1 text-[11px]">
					Related to what you are writing
				</p>
			{/if}

			{#each [{ title: 'In this project', rows: inProject }, { title: 'Elsewhere in your library', rows: elsewhere }] as group (group.title)}
				{#if group.rows.length > 0}
					<h3
						class="text-ink-muted bg-surface-sunken sticky top-0 px-3 py-1 text-[11px] font-medium"
					>
						{group.title}
					</h3>

					{#each group.rows as row (row.id)}
						<div class="border-line border-b px-3 py-2">
							<div class="text-ink-muted flex items-center gap-2 text-[11px]">
								<span
									class="inline-block h-2 w-2 shrink-0 rounded-sm"
									style:background="hsl({colourOf(row.label_id)})"
									aria-hidden="true"
								></span>
								<span>{nameOf(row.label_id)}</span>
								<span class="truncate">· {row.file_name ?? 'unknown paper'}</span>
								<span>· p. {pageLabelOf(row)}</span>
							</div>

							{#if row.note}
								<p class="text-ink mt-1 text-xs">{row.note}</p>
							{/if}

							{#if row.quote}
								<p class="text-ink-muted mt-1 text-xs italic">{row.quote}</p>
							{/if}

							<div class="mt-1 flex items-center gap-3">
								<button
									class="text-ink-muted hover:text-accent flex items-center gap-1 text-[11px]"
									onclick={() =>
										void showInPdf({
											sha256: row.sha256,
											page: row.page,
											selector: row.quote ? { quote: row.quote } : undefined
										})}
								>
									<Icon icon="BookOpen" size="s" />
									Show in PDF
								</button>

								<!--
									Offered only when a manuscript is open, because a citation
									needs somewhere to go. A note carries its paper's hash and
									its page, so this is the same insertion the citation panel
									makes from a search result.
								-->
								{#if $draftContext.cite}
									<button
										class="text-ink-muted hover:text-accent flex items-center gap-1 text-[11px]"
										onclick={() => void $draftContext.cite?.(row.sha256)}
									>
										<Icon icon="Quote" size="s" />
										Cite
									</button>
								{/if}
							</div>
						</div>
					{/each}
				{/if}
			{/each}
		{/if}
	</div>
</div>
