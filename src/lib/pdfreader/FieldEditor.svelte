<script lang="ts">
	import type { Annotation } from '$lib/stores/db';
	import type { ClientRectLike } from './location';

	/**
	 * The page number the paper prints.
	 *
	 * Something the machine worked out that only the reader can check, and the
	 * one that matters most: a mark's `page` is the sheet it sits on in the file,
	 * and a journal article beginning on page 843 calls its eleventh sheet 853.
	 * 853 is what a citation has to say — "p. 11" points at nothing anyone can
	 * look up.
	 *
	 * This once handled the quoted text as well. That went when the carets at
	 * either end of a mark became live: re-drawing a mark re-derives its words,
	 * so a second way to change them was a second answer to the same question,
	 * and the two could disagree.
	 */
	interface Props {
		mark: Annotation;
		at: ClientRectLike;
		onsave: (value: string) => void;
		onclose: () => void;
	}

	const { mark, at, onsave, onclose }: Props = $props();

	// svelte-ignore state_referenced_locally
	// The value as it was when the popup opened, which is what a draft is.
	let draft = $state(mark.page_label ?? String(mark.page));

	function commit() {
		onsave(draft.trim());
		onclose();
	}
</script>

<div
	class="border-line bg-surface-overlay absolute z-30 w-72 rounded border p-2 shadow-md"
	style:left="{at.left}px"
	style:top="{at.top + at.height + 6}px"
	role="group"
	aria-label="Page number for this mark"
	data-mark-menu
>
	<p class="text-ink-muted mb-1 text-[11px]">
		<!-- Said plainly, because the distinction is the entire point and is not
		     obvious until someone has cited the wrong number once. -->
		The number this page carries in the published paper. Sheet {mark.page} of the file.
	</p>

	<!-- svelte-ignore a11y_autofocus -->
	<input
		class="border-line bg-surface-sunken text-ink w-full rounded border px-2 py-1 text-xs"
		aria-label="Printed page number"
		autofocus
		bind:value={draft}
		onkeydown={(event) => {
			event.stopPropagation();
			if (event.key === 'Enter') commit();
			if (event.key === 'Escape') onclose();
		}}
	/>

	<div class="mt-2 flex items-center justify-end gap-2">
		<button class="text-ink-muted hover:text-ink px-2 py-0.5 text-[11px]" onclick={onclose}>
			Cancel
		</button>
		<button
			class="bg-accent text-accent-ink hover:bg-accent-hover rounded px-2 py-1 text-[11px] font-medium"
			onclick={commit}
		>
			Save
		</button>
	</div>
</div>
