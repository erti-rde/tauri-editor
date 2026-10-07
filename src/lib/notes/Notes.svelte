<script lang="ts">
	import { onMount } from 'svelte';

	import Icon from '$lib/icon/Icon.svelte';
	import { Button, Checkbox, Item, LabelChip, RadioGroup, SearchField } from '$lib/ui';
	import Loader from '$lib/loader/Loader.svelte';
	import { annotationsStore, pageLabelOf } from '$lib/stores/annotations.svelte';
	import {
		allAnnotations,
		allSourceNotes,
		embedPendingAnnotations,
		searchNotes,
		type NoteHit
	} from '$lib/stores/db';
	import { showInPdf } from '$lib/pdfreader/showInPdf';
	import { save } from '@tauri-apps/plugin-dialog';
	import { writeTextFile } from '@tauri-apps/plugin-fs';
	import { projectSources, sourceAliases } from '$lib/stores/db';
	import { canonical } from '$lib/citations/aliases';
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
	 * Notes on a source (M1b-8) are listed with the marks, each saying which it
	 * is: both are something the researcher wrote, and they ask the same
	 * question of them (ADR 004).
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
	let results = $state<NoteHit[]>([]);
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
				? await searchNotes(asked, { semantic, limit: 100 })
				: context
					? await searchNotes(context, { semantic: true, limit: 20 })
					: // Nothing asked: every note, newest first, each with its paper and
						// whether it's in this project. The plain list used to be cast to
						// this type without those, so every mark read "unknown paper".
						await searchNotes('', { limit: 100 });
			results = Array.isArray(found) ? found : [];
			ran = true;

			// A search by meaning matches against vectors, and a mark made while the
			// model was unavailable has none — so an empty answer here may mean
			// "nothing is about that" or "nothing has been prepared", and only one
			// of those is the reader's to solve.
			if (results.length === 0 && (semantic || context)) unprepared = await anyNotes();

			// Report back only for a search that followed the writing. A typed
			// query is the writer asking a question, and answering it should not
			// also put a mark in their margin.
			if (context && !asked) {
				draftMatches.set({
					paragraph: context,
					// By work, which is what the paragraph's citations resolve to.
					sources: results.map(({ hit }) => ({ sha256: hit.source_id, similarity: hit.similarity }))
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

	/**
	 * Whether there's a note of either kind, for a search that found none. An
	 * empty search by words filters nothing, so one result says there is,
	 * without reading every note to find out.
	 */
	async function anyNotes(): Promise<boolean> {
		const notes = await searchNotes('', { limit: 1 });
		return Array.isArray(notes) && notes.length > 0;
	}

	const inProject = $derived(results.filter(({ hit }) => hit.in_project !== false));
	const elsewhere = $derived(results.filter(({ hit }) => hit.in_project === false));

	/**
	 * Write the notes out.
	 *
	 * Markdown for reading and pasting, JSON for keeping. Neither touches the
	 * PDFs: writing marks into a file would change its bytes, and the library is
	 * keyed on the hash of those bytes.
	 */
	async function exportNotes(format: 'md' | 'json') {
		try {
			const [marks, notes] = await Promise.all([
				allAnnotations({ limit: 10_000 }),
				allSourceNotes()
			]);
			const written = marks.length + notes.length;
			if (written === 0) {
				errorToast('There are no notes to export yet.');
				return;
			}

			let contents: string;
			if (format === 'json') {
				contents = toSidecar(marks, notes);
			} else {
				const [sources, aliases] = await Promise.all([
					projectSources().catch(() => []),
					sourceAliases().catch(() => ({}))
				]);
				contents = toMarkdown(
					marks,
					sources.map((source) => ({
						sha256: source.sha256,
						title: titleOf(source.csl_json) ?? source.file_name
					})),
					$annotationsStore.labels,
					(id) => canonical(aliases, id),
					notes
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
			successToast(`Wrote ${written} ${written === 1 ? 'note' : 'notes'}.`);
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
		<SearchField
			label="Search your notes"
			placeholder="Search your notes…"
			bind:value={query}
			onkeydown={(event) => {
				if (event.key === 'Enter') void run();
			}}
			onclear={() => void run()}
		/>

		<!--
			Named for what it does rather than for what it is.

			"Follow what I am writing" described the mechanism and left the reader to
			work out the consequence — which is that with nothing typed here, the
			panel keeps showing notes about the paragraph the cursor is in. The
			second line says that outright, because a checkbox whose effect you have
			to discover by experiment is one you switch off.
		-->
		<Checkbox
			label="Show notes about the paragraph I'm in"
			description="Updates as you write, by meaning. Typing a search here takes over."
			bind:checked={following}
			onCheckedChange={(checked) => {
				followed = '';
				if (!checked) void run();
			}}
		/>

		<!--
			Only meaningful for a typed question. Following the writing always
			searches by meaning — a paragraph is not a phrase to look for literally —
			so with nothing typed this control decides nothing, and saying so beats
			leaving it looking broken.
		-->
		<RadioGroup
			label="How to search"
			hideLabel
			orientation="horizontal"
			options={[
				{ value: 'words', label: 'Words' },
				{ value: 'meaning', label: 'Meaning' }
			]}
			value={semantic ? 'meaning' : 'words'}
			disabled={following && !query.trim()}
			onValueChange={(value) => {
				semantic = value === 'meaning';
				void run();
			}}
		/>

		<div class="text-caption text-ink-muted flex items-center gap-1">
			<span>Export</span>
			<Button variant="ghost" size="sm" onclick={() => void exportNotes('md')}>Markdown</Button>
			<Button variant="ghost" size="sm" onclick={() => void exportNotes('json')}>JSON</Button>
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
				<Button
					variant="primary"
					size="sm"
					class="mt-2"
					loading={preparing}
					onclick={() => void prepare()}
				>
					{preparing ? 'Preparing…' : 'Prepare my notes'}
				</Button>
			</div>
		{:else if results.length === 0}
			<p class="text-ink-muted p-3 text-xs">
				{ran && query.trim()
					? 'Nothing matches that.'
					: 'Nothing marked yet. Highlight a passage while reading and it will appear here.'}
			</p>
		{:else}
			{#if following && !query.trim() && followed}
				<p class="text-caption text-ink-muted bg-surface-sunken border-line border-b px-3 py-1">
					Related to what you are writing
				</p>
			{/if}

			{#each [{ title: 'In this project', rows: inProject }, { title: 'Elsewhere in your library', rows: elsewhere }] as group (group.title)}
				{#if group.rows.length > 0}
					<h3
						class="text-caption text-ink-muted bg-surface-sunken sticky top-0 px-3 py-1 font-medium"
					>
						{group.title}
					</h3>

					{#each group.rows as row (`${row.kind}:${row.hit.id}`)}
						{#if row.kind === 'annotation'}
							{@const hit = row.hit}
							<Item text={hit.note ?? undefined} quote={hit.quote ?? undefined}>
								{#snippet meta()}
									<LabelChip name={nameOf(hit.label_id)} colour={colourOf(hit.label_id)} />
									<span class="truncate">· {hit.file_name ?? 'unknown paper'}</span>
									<span class="shrink-0">· p. {pageLabelOf(hit)}</span>
								{/snippet}

								{#snippet actions()}
									<Button
										variant="ghost"
										size="sm"
										onclick={() =>
											void showInPdf({
												sha256: hit.sha256,
												page: hit.page,
												selector: hit.quote ? { quote: hit.quote } : undefined
											})}
									>
										<Icon icon="BookOpen" size="s" />
										Show in PDF
									</Button>

									<!--
										Offered only when a manuscript is open, because a citation
										needs somewhere to go. A note carries the work its paper
										belongs to, so this is the same insertion the citation panel
										makes from a search result. Show in PDF, above, keeps the
										file's own hash: the work may be a book with no file.
									-->
									{#if $draftContext.cite}
										<Button
											variant="ghost"
											size="sm"
											onclick={() => void $draftContext.cite?.(hit.source_id)}
										>
											<Icon icon="Quote" size="s" />
											Cite
										</Button>
									{/if}
								{/snippet}
							</Item>
						{:else}
							{@const hit = row.hit}
							<!--
								A note on the work as a whole (M1b-8): named by the work, since a
								book entered by hand has no file, and said to be a note, so the
								two kinds tell apart without the label's colour.
							-->
							<Item text={hit.body || undefined} quote={hit.quote ?? undefined}>
								{#snippet meta()}
									{#if hit.label_id}
										<LabelChip name={nameOf(hit.label_id)} colour={colourOf(hit.label_id)} />
									{:else}
										<span class="shrink-0">Note</span>
									{/if}
									<span class="truncate">· {hit.title ?? 'unknown source'}</span>
									{#if hit.page_label}
										<span class="shrink-0">· p. {hit.page_label}</span>
									{/if}
								{/snippet}

								{#snippet actions()}
									{#if $draftContext.cite}
										<Button
											variant="ghost"
											size="sm"
											onclick={() =>
												void $draftContext.cite?.(hit.source_id, hit.page_label ?? undefined)}
										>
											<Icon icon="Quote" size="s" />
											{hit.page_label ? `Cite with p. ${hit.page_label}` : 'Cite'}
										</Button>
									{/if}
								{/snippet}
							</Item>
						{/if}
					{/each}
				{/if}
			{/each}
		{/if}
	</div>
</div>
