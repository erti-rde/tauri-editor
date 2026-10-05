<script lang="ts">
	import { onMount } from 'svelte';

	import type { AnnotationLabel, NewSourceNote, SourceNote } from '$lib/stores/db';
	import { Button, Select, TextArea, TextField, Tooltip } from '$lib/ui';

	/**
	 * A note on a work, new or being changed (M1b-8 AC-2, UX-3): what was
	 * thought, the words copied, the page as printed, and a label. Saved with
	 * ⌘↩ as well as the button.
	 */
	interface Props {
		/** The note being changed; a new one without. */
		note?: SourceNote;
		labels: AnnotationLabel[];
		onsave: (fields: Omit<NewSourceNote, 'id' | 'sha256'>) => Promise<void>;
		oncancel: () => void;
		/** Offered only for a note that's already kept. */
		ondelete?: () => void;
	}

	let { note, labels, onsave, oncancel, ondelete }: Props = $props();

	const NO_LABEL = 'none';

	// svelte-ignore state_referenced_locally
	let body = $state(note?.body ?? '');
	// svelte-ignore state_referenced_locally
	let quote = $state(note?.quote ?? '');
	// svelte-ignore state_referenced_locally
	let page = $state(note?.page_label ?? '');
	// svelte-ignore state_referenced_locally
	let label = $state(note?.label_id ?? NO_LABEL);
	let tried = $state(false);
	let saving = $state(false);
	let form: HTMLFormElement | undefined = $state();

	const empty = $derived(!body.trim() && !quote.trim());
	const labelItems = $derived([
		{ value: NO_LABEL, label: 'No label' },
		// A label that's been switched off stays on the notes that have it.
		...labels
			.filter((l) => l.enabled || l.id === note?.label_id)
			.map((l) => ({ value: l.id, label: l.name }))
	]);

	onMount(() => form?.querySelector('textarea')?.focus());

	/** ⌘↩ saves from any field, and Escape leaves the note as it was. */
	function keys(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void save();
		} else if (e.key === 'Escape' && !e.isComposing) {
			// Handled here: left to bubble, the sidebar would close on it too,
			// and take any unsaved details with it.
			e.preventDefault();
			oncancel();
		}
	}

	async function save() {
		tried = true;
		if (empty || saving) return;
		saving = true;
		try {
			await onsave({
				body,
				quote: quote || null,
				page_label: page || null,
				label_id: label === NO_LABEL ? null : label
			});
		} finally {
			saving = false;
		}
	}
</script>

<form
	bind:this={form}
	class="border-line grid gap-3 rounded border p-3"
	aria-label={note ? 'Change the note' : 'New note'}
	onsubmit={(e) => {
		e.preventDefault();
		void save();
	}}
>
	<TextArea
		label="Note"
		hint="Markdown"
		rows={3}
		bind:value={body}
		onkeydown={keys}
		error={tried && empty ? 'Write a note, or the words you’re quoting.' : undefined}
	/>
	<TextArea
		label="Quote (optional)"
		hint="The exact words, if you’re copying from the source"
		rows={2}
		class="font-page"
		bind:value={quote}
		onkeydown={keys}
	/>
	<div class="grid grid-cols-2 gap-3">
		<TextField
			label="Page (optional)"
			hint="As printed: 853, xiv"
			bind:value={page}
			onkeydown={keys}
		/>
		<Select type="single" label="Label" items={labelItems} bind:value={label} />
	</div>
	<div class="flex items-center gap-2">
		{#if ondelete}
			<Button variant="ghost" size="sm" disabled={saving} onclick={ondelete}>Delete</Button>
		{/if}
		<span class="flex-1"></span>
		<Button variant="ghost" size="sm" disabled={saving} onclick={oncancel}>Cancel</Button>
		<Tooltip label="Save" shortcut="Mod Enter" side="top">
			{#snippet children(trigger)}
				<Button {...trigger} variant="primary" size="sm" type="submit" loading={saving}>Save</Button
				>
			{/snippet}
		</Tooltip>
	</div>
</form>
