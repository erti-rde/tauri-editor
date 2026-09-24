<script lang="ts">
	import type { Annotation, AnnotationLabel } from '$lib/stores/db';
	import type { ClientRectLike } from './location';

	/**
	 * Everything that can be done to a mark already made.
	 *
	 * Words, not pictures. Zotero's is a plain list of labels with a colour chip
	 * on the colour rows and a tick on the one in force, and nothing else — and
	 * that is the right call: an icon beside "Delete" or "Convert to underline"
	 * carries no information the word does not, and eleven of them in a column
	 * turn a menu into a texture you have to read past.
	 *
	 * The colours are the exception, because there the chip *is* the information:
	 * a name someone chose ("Limitation") does not say which colour it is.
	 *
	 * Reached two ways — the right button on a mark, and the `⋯` in its popup —
	 * and both give the same menu.
	 *
	 * Zotero's two differ: it hides the corrections behind the popup, on the
	 * grounds that the fields they edit are only on screen there. That is a
	 * defensible line and it is not the one drawn here. A menu that offers
	 * different things depending on how it was opened has to be learned twice,
	 * and a reader who wants to fix a page number has no way to know which of the
	 * two routes carries it.
	 */
	interface Props {
		mark: Annotation;
		at: ClientRectLike;
		labels: AnnotationLabel[];
		onlabel: (labelId: string | null) => void;
		onconvert: () => void;
		onpagelabel: () => void;
		oncopyimage: () => void;
		onsaveimage: () => void;
		ondelete: () => void;
		onclose: () => void;
	}

	const {
		mark,
		at,
		labels,
		onlabel,
		onconvert,
		onpagelabel,
		oncopyimage,
		onsaveimage,
		ondelete,
		onclose
	}: Props = $props();

	const usable = $derived(labels.filter((label) => label.enabled));
	const isText = $derived(mark.kind === 'highlight');
	const isArea = $derived(mark.kind === 'area');
</script>

<!--
	`group` rather than `menu`: a menu promises arrow-key navigation between its
	items, and these are each tabbable instead.

	`data-mark-menu` is how the reader knows a pointer landed in here and should
	not dismiss it. Stopping propagation does not work — Svelte delegates
	`pointerdown` to the document root, so a handler here runs after a listener
	bound directly to the pages has already closed the menu, taking the button out
	from under the click.
-->
<div
	class="border-line bg-surface-overlay absolute z-30 min-w-52 rounded-md border py-1 shadow-lg"
	style:left="{at.left}px"
	style:top="{at.top + at.height + 6}px"
	role="group"
	aria-label="What to do with this highlight"
	data-mark-menu
>
	{#snippet row(label: string, action: () => void, danger = false)}
		<button
			class="hover:bg-surface-hover flex w-full items-center px-3 py-1 text-left text-xs {danger
				? 'text-ink hover:text-danger'
				: 'text-ink'}"
			onclick={action}
		>
			{label}
		</button>
	{/snippet}

	{#snippet divider()}
		<div class="bg-line my-1 h-px" aria-hidden="true"></div>
	{/snippet}

	{#each usable as label (label.id)}
		<button
			class="hover:bg-surface-hover text-ink flex w-full items-center gap-2 px-3 py-1 text-left text-xs"
			onclick={() => onlabel(label.id)}
			aria-pressed={label.id === mark.label_id}
		>
			<!-- The tick sits in its own column so the names line up whether or not
			     one is in force. -->
			<span class="w-2.5 shrink-0" aria-hidden="true">
				{#if label.id === mark.label_id}✓{/if}
			</span>
			<span
				class="ring-line-strong inline-block h-3 w-3 shrink-0 rounded-sm ring-1 ring-inset"
				style:background="hsl({label.colour})"
			></span>
			<span>{label.name}</span>
		</button>
	{/each}

	{@render divider()}

	<!--
		The page the paper prints, not the sheet it sits on. A citation that says
		"p. 11" points at nothing a reader of the journal can find.
	-->
	{@render row(
		mark.page_label ? `Edit page number (${mark.page_label})…` : 'Edit page number…',
		onpagelabel
	)}

	{#if isArea}
		{@render divider()}
		{@render row('Copy image', oncopyimage)}
		{@render row('Save image as…', onsaveimage)}
	{/if}

	{#if isText}
		{@render divider()}
		{@render row(
			mark.style === 'underline' ? 'Convert to highlight' : 'Convert to underline',
			onconvert
		)}
	{/if}

	{@render divider()}

	{@render row('Delete', ondelete, true)}

	<button class="sr-only" onclick={onclose}>Close</button>
</div>
