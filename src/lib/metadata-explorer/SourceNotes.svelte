<script lang="ts">
	import { onMount } from 'svelte';

	import { describeError } from '$lib/ipc';
	import { log } from '$lib/log';
	import { colourFor, pageLabelOf } from '$lib/stores/annotations.svelte';
	import {
		annotationLabels,
		deleteSourceNote,
		saveSourceNote,
		type AnnotationLabel,
		type NewSourceNote,
		type SourceNote,
		type WorkNotes
	} from '$lib/stores/db';
	import { errorToast } from '$lib/toast/Toast.svelte';
	import { Button, ConfirmDialog, EmptyState, Item, LabelChip } from '$lib/ui';

	import NoteForm from './NoteForm.svelte';
	import { notesInPageOrder } from './notesOrder';

	/**
	 * A work's Notes tab (M1b-8, UX-3): its own notes, then the marks on its
	 * files by page. Notes are written and changed here; marks are made in the
	 * PDF, so here they're only listed.
	 */
	interface Props {
		/** The work. */
		id: string;
		/** Null until read. */
		notes: WorkNotes | null;
		/** A note was saved or deleted: read them again. */
		onchange: () => Promise<void>;
	}

	let { id, notes, onchange }: Props = $props();

	let labels: AnnotationLabel[] = $state([]);
	/** The form showing: a new note's, or the id of the note being changed. */
	let editing: 'new' | string | null = $state(null);
	let deleting: SourceNote | null = $state(null);
	let busy = $state(false);
	const uid = $props.id();

	const ordered = $derived(notesInPageOrder(notes?.notes ?? []));

	onMount(async () => {
		try {
			labels = await annotationLabels();
		} catch (error) {
			// Notes still list and save; they show without their label's name.
			log.warn('Could not read the highlight labels', error);
		}
	});

	const labelOf = (labelId: string | null) => labels.find((l) => l.id === labelId);

	async function save(fields: Omit<NewSourceNote, 'id' | 'sha256'>, note?: SourceNote) {
		try {
			await saveSourceNote({ ...fields, id: note?.id ?? crypto.randomUUID(), sha256: id });
			editing = null;
			await onchange();
		} catch (error) {
			errorToast(`Could not save the note: ${describeError(error)}`);
		}
	}

	async function remove() {
		if (!deleting) return;
		busy = true;
		try {
			await deleteSourceNote(deleting.id);
			deleting = null;
			editing = null;
			await onchange();
		} catch (error) {
			errorToast(`Could not delete the note: ${describeError(error)}`);
		} finally {
			busy = false;
		}
	}
</script>

{#snippet labelled(labelId: string | null)}
	{@const label = labelOf(labelId)}
	{#if label}
		<LabelChip name={label.name} colour={colourFor(labels, labelId)} />
	{/if}
{/snippet}

<div class="grid gap-3">
	{#if editing === 'new'}
		<NoteForm {labels} onsave={(fields) => save(fields)} oncancel={() => (editing = null)} />
	{:else}
		<div>
			<Button size="sm" onclick={() => (editing = 'new')}>New note</Button>
		</div>
	{/if}

	{#if notes && ordered.length === 0 && notes.marks.length === 0 && editing !== 'new'}
		<EmptyState
			message="No notes on this source yet."
			detail="Write what you made of it, or copy its words with the page they’re on."
		/>
	{/if}

	<ul aria-label="Notes">
		{#each ordered as note (note.id)}
			<li>
				{#if editing === note.id}
					<NoteForm
						{note}
						{labels}
						onsave={(fields) => save(fields, note)}
						oncancel={() => (editing = null)}
						ondelete={() => (deleting = note)}
					/>
				{:else}
					<Item quote={note.quote ?? undefined} clamp>
						{#snippet meta()}
							{@render labelled(note.label_id)}
							{#if note.page_label}
								<span class="shrink-0"
									>{labelOf(note.label_id) ? '· ' : ''}p. {note.page_label}</span
								>
							{/if}
						{/snippet}
						{#snippet body()}
							<!-- Markdown, shown as written: its line breaks kept. -->
							{#if note.body}<p class="whitespace-pre-line">{note.body}</p>{/if}
						{/snippet}
						{#snippet actions()}
							<Button variant="ghost" size="sm" onclick={() => (editing = note.id)}>Edit</Button>
						{/snippet}
					</Item>
				{/if}
			</li>
		{/each}
	</ul>

	{#if notes && notes.marks.length > 0}
		<section aria-labelledby="{uid}-marks">
			<h3 id="{uid}-marks" class="text-caption text-ink-muted font-medium">Marked in the PDF</h3>
			<ul>
				{#each notes.marks as mark (mark.id)}
					<li>
						<Item
							quote={mark.quote ?? undefined}
							text={mark.note ?? (mark.kind === 'area' ? 'An area of the page' : undefined)}
							clamp
						>
							{#snippet meta()}
								{@render labelled(mark.label_id)}
								<span class="shrink-0"
									>{labelOf(mark.label_id) ? '· ' : ''}p. {pageLabelOf(mark)}</span
								>
							{/snippet}
						</Item>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<ConfirmDialog
	open={deleting !== null}
	onOpenChange={(open) => {
		if (!open) deleting = null;
	}}
	title="Delete this note?"
	action="Delete"
	{busy}
	onConfirm={remove}
>
	{#snippet consequences()}
		Its words{deleting?.quote ? ', and the quote with them,' : ''} can’t be put back. The source stays.
	{/snippet}
</ConfirmDialog>
