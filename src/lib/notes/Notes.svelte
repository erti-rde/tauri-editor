<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { get } from 'svelte/store';

	import Icon from '$lib/icon/Icon.svelte';
	import { Button, Item, LabelChip, RadioGroup, SearchField, Switch } from '$lib/ui';
	import Loader from '$lib/loader/Loader.svelte';
	import { annotationsStore, pageLabelOf } from '$lib/stores/annotations.svelte';
	import {
		allAnnotations,
		allSourceNotes,
		embedPendingAnnotations,
		searchLibrary,
		searchNotes,
		type NoteHit,
		type ScoredChunk
	} from '$lib/stores/db';
	import { showInPdf } from '$lib/pdfreader/showInPdf';
	import { save } from '@tauri-apps/plugin-dialog';
	import { writeTextFile } from '@tauri-apps/plugin-fs';
	import { projectSources, sourceAliases } from '$lib/stores/db';
	import { canonical } from '$lib/citations/aliases';
	import { errorToast, successToast } from '$lib/toast/Toast.svelte';
	import { toMarkdown, toSidecar } from './export';
	import { draftContext, draftMatches, firstWords, matchesFrom } from './draftContext';
	import { followSetting } from './writingSettings';
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
	const following = $derived($followSetting);
	/** The setting has been read, so following, or not, is what the writer chose (M3-4). */
	let settled = $state(false);
	/** The paragraph the results on screen were found for, if they were. */
	let followed = $state('');
	let results = $state<NoteHit[]>([]);
	/** Passages from the papers themselves, found only while following (M3-1 AC-2). */
	let passages = $state<ScoredChunk[]>([]);
	/** What's on screen: notes and passages for a paragraph, or a list or search of notes. */
	let shown = $state<'following' | 'notes'>('notes');
	let loading = $state(false);
	let ran = $state(false);

	/**
	 * Which search is the latest. An answer to an older one is dropped: a
	 * paragraph left behind can answer after the one the cursor is in now.
	 */
	let generation = 0;

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

	onMount(async () => {
		void annotationsStore.loadLabels();
		await followSetting.load();
		settled = true;
		// Following has a paragraph to go on, and the effect below asks about it.
		if (!(get(followSetting) && get(draftContext).paragraph)) void run();
	});

	/**
	 * Turned on or off, here or in Settings: either way, what's on screen was
	 * answering the other question.
	 */
	let wasFollowing: boolean | null = null;
	$effect(() => {
		const on = following;
		if (!settled) return;
		untrack(() => {
			if (wasFollowing === null || on === wasFollowing) {
				wasFollowing = on;
				return;
			}
			wasFollowing = on;
			followed = '';
			if (on) return;
			// Not following, so nothing found for a paragraph stands: the margin
			// shouldn't keep pointing at it either.
			draftMatches.set({ paragraph: '', sources: [] });
			void run();
		});
	});

	/**
	 * Follow the writing whenever it moves on, unless a question has been typed
	 * (M3-1 AC-5).
	 *
	 * The editor decides when it has moved on (AC-3): when the cursor leaves a
	 * paragraph, or after a pause in one. Guarded on the paragraph actually
	 * changing, since repeating a search for text that hasn't would cost an
	 * embedding for nothing. A typed search clears `followed`, so clearing the
	 * box asks about the paragraph again.
	 */
	$effect(() => {
		const paragraph = $draftContext.paragraph;
		if (!settled || !following || query.trim() || !paragraph || paragraph === followed) return;

		followed = paragraph;
		void follow(paragraph);
	});

	/**
	 * Notes and passages close to a paragraph, as two groups (M3-1 AC-2).
	 *
	 * Asked for apart: a short note doesn't score comparably against a long
	 * passage, so in one ranked list the passages would crowd the notes out.
	 * Both reach past the open project, which comes first: a note taken last year
	 * for another project is the one most likely to be forgotten.
	 */
	async function follow(paragraph: string) {
		const ticket = ++generation;
		// The last paragraph's results stay until this one's arrive, so the panel
		// doesn't blink each time the writer pauses.
		if (shown !== 'following') loading = true;
		try {
			const [notes, papers] = await Promise.all([
				searchLibrary(paragraph, {
					kinds: ['annotation', 'source_note'],
					limit: 20,
					includeLibrary: true
				}),
				searchLibrary(paragraph, { kinds: ['chunk'], limit: 10, includeLibrary: true })
			]);
			if (ticket !== generation) return;

			results = notes.filter((row): row is NoteHit => row.kind !== 'chunk');
			passages = papers.flatMap((row) => (row.kind === 'chunk' ? [row.hit] : []));
			failure = null;
			shown = 'following';
			ran = true;

			// As for a search by meaning: no notes may mean none are prepared.
			const none = results.length === 0 && (await anyNotes());
			// Asked again while that was answered: what's on screen is the newer
			// search's, and so are the matches the nudge reads.
			if (ticket !== generation) return;
			unprepared = none;

			draftMatches.set(matchesFrom(paragraph, results));
		} catch (thrown) {
			if (ticket !== generation) return;
			log.error('Could not follow the writing', thrown);
			fail(thrown);
		} finally {
			if (ticket === generation) loading = false;
		}
	}

	async function run() {
		const ticket = ++generation;
		// What's shown next isn't about the paragraph, so clearing the search
		// will ask about it again.
		followed = '';
		loading = true;
		failure = null;
		unprepared = false;
		try {
			const asked = query.trim();
			const found = asked
				? await searchNotes(asked, { semantic, limit: 100 })
				: // Nothing asked: every note, newest first, each with its paper and
					// whether it's in this project. The plain list used to be cast to
					// this type without those, so every mark read "unknown paper".
					await searchNotes('', { limit: 100 });
			if (ticket !== generation) return;
			results = Array.isArray(found) ? found : [];
			passages = [];
			shown = 'notes';
			ran = true;

			// A search by meaning matches against vectors, and a mark made while the
			// model was unavailable has none — so an empty answer here may mean
			// "nothing is about that" or "nothing has been prepared", and only one
			// of those is the reader's to solve.
			if (results.length === 0 && semantic) {
				const none = await anyNotes();
				if (ticket === generation) unprepared = none;
			}
		} catch (thrown) {
			if (ticket !== generation) return;
			log.error('Could not search the marks', thrown);
			fail(thrown);
		} finally {
			if (ticket === generation) loading = false;
		}
	}

	/**
	 * Before a project is open there is no library to ask, which is an ordinary
	 * state for a panel that can be opened at any time — but it is still said,
	 * because a panel that goes blank for two different reasons cannot be acted
	 * on.
	 */
	function fail(thrown: unknown) {
		results = [];
		passages = [];
		shown = 'notes';
		ran = true;
		failure = thrown instanceof Error ? thrown.message : String(thrown);
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
			// Asked again, the same question: the paragraph, if that's what was shown.
			if (shown === 'following' && followed) await follow(followed);
			else await run();
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
	 * The works the followed paragraph already cites (M3-1 AC-4). Read from the
	 * editor as it changes, so citing from here marks the result at once without
	 * searching again, and only while it's the paragraph the results are for.
	 */
	const cited = $derived(
		shown === 'following' && $draftContext.paragraph === followed
			? new Set($draftContext.cited)
			: new Set<string>()
	);

	/**
	 * A result the paragraph already cites isn't news: it goes last, keeping
	 * the order otherwise (M3-1 AC-4).
	 */
	function citedLast<T extends { hit: { source_id: string } } | { source_id: string }>(
		rows: T[]
	): T[] {
		const id = (row: T) => ('hit' in row ? row.hit.source_id : row.source_id);
		return [
			...rows.filter((row) => !cited.has(id(row))),
			...rows.filter((row) => cited.has(id(row)))
		];
	}

	const yourNotes = $derived(citedLast(results));
	const fromPapers = $derived(citedLast(passages));

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

{#snippet citedHere(id: string)}
	<!-- In words, not only by place in the list (M3-1 AC-4). -->
	{#if cited.has(id)}<span class="shrink-0">· cited here</span>{/if}
{/snippet}

{#snippet unpreparedNotes()}
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
{/snippet}

{#snippet note(row: NoteHit)}
	{#if row.kind === 'annotation'}
		{@const hit = row.hit}
		<Item text={hit.note ?? undefined} quote={hit.quote ?? undefined}>
			{#snippet meta()}
				<LabelChip name={nameOf(hit.label_id)} colour={colourOf(hit.label_id)} />
				<span class="truncate">· {hit.file_name ?? 'unknown paper'}</span>
				<span class="shrink-0">· p. {pageLabelOf(hit)}</span>
				{@render citedHere(hit.source_id)}
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
					file's own hash: the work may be a book with no file. The page
					goes with it (M3-2 AC-1): the one the paper prints when it is
					known, else the sheet, as everywhere a mark's page is shown.
				-->
				{#if $draftContext.cite}
					{@const page = pageLabelOf(hit)}
					<Button
						variant="ghost"
						size="sm"
						onclick={() => void $draftContext.cite?.(hit.source_id, page)}
					>
						<Icon icon="Quote" size="s" />
						Cite with p. {page}
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
				{@render citedHere(hit.source_id)}
			{/snippet}

			{#snippet actions()}
				{#if $draftContext.cite}
					<Button
						variant="ghost"
						size="sm"
						onclick={() => void $draftContext.cite?.(hit.source_id, hit.page_label ?? undefined)}
					>
						<Icon icon="Quote" size="s" />
						{hit.page_label ? `Cite with p. ${hit.page_label}` : 'Cite'}
					</Button>
				{/if}
			{/snippet}
		</Item>
	{/if}
{/snippet}

<!--
	A passage from a paper (M3-1 AC-2): one line of source and page, then the
	passage in two lines, which open to the whole of it.
-->
{#snippet paper(passage: ScoredChunk)}
	<Item quote={passage.text} clamp>
		{#snippet meta()}
			<span class="truncate">{passage.title ?? 'unknown paper'}</span>
			{#if passage.page_start}
				<span class="shrink-0">· p. {passage.page_start}</span>
			{/if}
			{@render citedHere(passage.source_id)}
		{/snippet}

		{#snippet actions()}
			<Button
				variant="ghost"
				size="sm"
				onclick={() =>
					void showInPdf({
						sha256: passage.sha256,
						page: passage.page_start ?? 1,
						selector: { quote: passage.text }
					})}
			>
				<Icon icon="BookOpen" size="s" />
				Show in PDF
			</Button>
			<!--
				A passage knows only its sheet: the page the paper prints isn't
				stored with it (M3-2 AC-1 allows the sheet, plan §5 the rest).
			-->
			{#if $draftContext.cite}
				{@const page = passage.page_start ? String(passage.page_start) : undefined}
				<Button
					variant="ghost"
					size="sm"
					onclick={() => void $draftContext.cite?.(passage.source_id, page)}
				>
					<Icon icon="Quote" size="s" />
					{page ? `Cite with p. ${page}` : 'Cite'}
				</Button>
			{/if}
		{/snippet}
	</Item>
{/snippet}

<div class="flex h-full flex-col">
	<div class="border-line flex flex-col gap-2 border-b p-2">
		<SearchField
			label="Search your notes"
			placeholder="Search your notes…"
			bind:value={query}
			onkeydown={(event) => {
				if (event.key === 'Enter') void run();
			}}
			onclear={() => {
				// Following resumes on its own (AC-5): the effect asks about the
				// paragraph again once the box is empty.
				followed = '';
				if (!(following && $draftContext.paragraph)) void run();
			}}
		/>

		<!--
			Named for what it does rather than for what it is (M3-1 AC-1). With
			nothing typed here, the panel shows what's close to the paragraph the
			cursor is in, and the line under it says which paragraph that is, so the
			reader never has to work out what the list is answering.
		-->
		<Switch
			label="Follow my writing"
			checked={following}
			onCheckedChange={(checked) => void followSetting.setEnabled(checked)}
		/>
		{#if following && shown === 'following' && followed && !query.trim()}
			<p class="text-caption text-ink-muted truncate">
				Related to: <em>{firstWords(followed)}</em>
			</p>
		{/if}

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
		{:else if shown === 'following'}
			{#if results.length === 0 && passages.length === 0 && !unprepared}
				<p class="text-ink-muted p-3 text-xs">
					Nothing in your notes or papers is close to this paragraph.
				</p>
			{:else}
				<h3
					class="text-caption text-ink-muted bg-surface-sunken sticky top-0 px-3 py-1 font-medium"
				>
					Your notes ({yourNotes.length})
				</h3>
				{#each yourNotes as row (`${row.kind}:${row.hit.id}`)}
					{@render note(row)}
				{:else}
					{#if unprepared}
						{@render unpreparedNotes()}
					{:else}
						<p class="text-ink-muted px-3 py-2 text-xs">None close to this paragraph.</p>
					{/if}
				{/each}

				<h3
					class="text-caption text-ink-muted bg-surface-sunken sticky top-0 px-3 py-1 font-medium"
				>
					From your papers ({fromPapers.length})
				</h3>
				{#each fromPapers as passage (`${passage.sha256}#${passage.idx}`)}
					{@render paper(passage)}
				{:else}
					<p class="text-ink-muted px-3 py-2 text-xs">None close to this paragraph.</p>
				{/each}
			{/if}
		{:else if results.length === 0 && unprepared}
			{@render unpreparedNotes()}
		{:else if results.length === 0}
			<p class="text-ink-muted p-3 text-xs">
				{ran && query.trim()
					? 'Nothing matches that.'
					: 'Nothing marked yet. Highlight a passage while reading and it will appear here.'}
			</p>
		{:else}
			{#each [{ title: 'In this project', rows: inProject }, { title: 'Elsewhere in your library', rows: elsewhere }] as group (group.title)}
				{#if group.rows.length > 0}
					<h3
						class="text-caption text-ink-muted bg-surface-sunken sticky top-0 px-3 py-1 font-medium"
					>
						{group.title}
					</h3>

					{#each group.rows as row (`${row.kind}:${row.hit.id}`)}
						{@render note(row)}
					{/each}
				{/if}
			{/each}
		{/if}
	</div>
</div>
