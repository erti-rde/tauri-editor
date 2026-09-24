<script lang="ts">
	import Icon from '$lib/icon/Icon.svelte';

	import type { Annotation } from '$lib/stores/db';
	import type { ClientRectLike } from './location';

	/**
	 * The card that opens on a mark, where the mark is.
	 *
	 * Built on the shape Zotero's annotation popup has, because that shape is
	 * doing real work. A header saying what kind of mark this is and what page it
	 * is on, in the mark's own colour; a `⋯` for everything that is not writing;
	 * and then the comment field, which is most of the card because writing down
	 * what you make of a passage is the reason for marking it.
	 *
	 * Left click opens this. Everything else — recolouring, converting,
	 * correcting, deleting — is behind the `⋯` or the right button, so the common
	 * act is one click and the rest are two.
	 *
	 * Zotero has a tags row below the comment. Erti has no tags: they were
	 * considered and declined when this was planned, in favour of labels that
	 * mean something and are shared across the library.
	 */
	interface Props {
		mark: Annotation;
		at: ClientRectLike;
		colour: string;
		/** What the paper calls this page, which is what a citation must say. */
		page: string;
		onsave: (note: string) => void;
		onmenu: (at: { x: number; y: number }) => void;
		onpagelabel: () => void;
		onclose: () => void;
	}

	const { mark, at, colour, page, onsave, onmenu, onpagelabel, onclose }: Props = $props();

	// svelte-ignore state_referenced_locally
	// The initial value is exactly what is wanted: this is a draft of the note as
	// it was when the popup opened, and the component is mounted fresh for each
	// mark. Deriving it would throw away what the reader had typed the moment
	// anything else about the mark changed.
	let draft = $state(mark.note ?? '');

	function commit() {
		// Saved on the way out rather than per keystroke: this writes to the
		// database and re-embeds, and doing that on every character would put an
		// inference behind every letter typed.
		if (draft !== (mark.note ?? '')) onsave(draft);
	}

	const kind = $derived(
		mark.kind === 'area'
			? ('Crop' as const)
			: mark.kind === 'page-note'
				? ('StickyNote' as const)
				: mark.style === 'underline'
					? ('Underline' as const)
					: ('Highlighter' as const)
	);
</script>

<div
	class="border-line bg-surface-overlay absolute z-30 w-64 rounded-md border shadow-lg"
	style:left="{at.left}px"
	style:top="{at.top + at.height + 8}px"
	role="group"
	aria-label="Note on this passage"
	data-mark-menu
>
	<header class="flex items-center gap-1.5 px-2 pt-1.5 pb-1">
		<!--
			The mark's own kind, in the mark's own colour. Two things at once, and
			the only place either is said: down a list of thirty in the panel a
			colour is enough, but a card floating over the page has no list to be
			read against.
		-->
		<span style:color="hsl({colour})" aria-hidden="true">
			<Icon icon={kind} size="s" />
		</span>

		<!--
			Double-click to correct it, as in Zotero. Also on the menu, because a
			double click on a label is not a thing anyone finds by looking.
		-->
		<button
			class="text-ink-muted hover:text-ink flex items-baseline gap-1 text-[11px]"
			ondblclick={onpagelabel}
			title="The page this paper prints. Double-click to correct it."
		>
			<span>Page</span>
			<span class="text-ink font-medium">{page}</span>
		</button>

		<button
			class="text-ink-muted hover:bg-surface-hover hover:text-ink ml-auto rounded px-1.5 leading-none"
			aria-label="More things to do with this mark"
			title="More"
			onclick={(event) => {
				const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
				onmenu({ x: box.left, y: box.bottom });
			}}
		>
			···
		</button>
	</header>

	<!-- svelte-ignore a11y_autofocus -->
	<textarea
		class="text-ink placeholder:text-ink-faint w-full resize-none bg-transparent px-2 pb-2 text-xs"
		rows="4"
		autofocus
		placeholder="Add comment"
		bind:value={draft}
		onblur={commit}
		onkeydown={(event) => {
			event.stopPropagation();
			if (event.key === 'Escape') {
				commit();
				onclose();
			}
			// Enter is for paragraphs. Saving is leaving, or the shortcut.
			if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
				commit();
				onclose();
			}
		}}></textarea>
</div>
