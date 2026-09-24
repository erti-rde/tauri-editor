<script lang="ts">
	import { untrack } from 'svelte';

	import Icon from '$lib/icon/Icon.svelte';

	import type { Annotation, AnnotationLabel } from '$lib/stores/db';
	import { pageLabelOf } from '$lib/stores/annotations.svelte';
	import { byReadingOrder } from './order';

	/**
	 * What has been marked on this paper.
	 *
	 * In reading order rather than newest first, because the question this answers
	 * is "what did I find in this paper", and a paper is read front to back and
	 * top to bottom. The other question — "where did I write something about this
	 * idea" — is the notes panel's, and wants a different order entirely.
	 */
	interface Props {
		annotations: Annotation[];
		labels: AnnotationLabel[];
		onjump: (annotation: Annotation) => void;
		ondelete: (id: string) => void;
		onnote: (annotation: Annotation, note: string) => void;
		onlabel: (annotation: Annotation, labelId: string | null) => void;
		/**
		 * A mark to make sure is visible — the one just made.
		 *
		 * A new mark landing under a filter that hides it, or below the fold of a
		 * long list, reads as not having been saved. Neither is something the
		 * reader should have to work around by clearing a filter themselves.
		 */
		reveal?: string | null;
		/**
		 * Inside the reader's own sidebar, which already draws the edge and the
		 * heading. On its own it is the panel; embedded it is one tab of one.
		 */
		embedded?: boolean;
	}

	const {
		annotations,
		labels,
		onjump,
		ondelete,
		onnote,
		onlabel,
		reveal = null,
		embedded = false
	}: Props = $props();

	let filter: string | null = $state(null);
	let editing: string | null = $state(null);

	const shown = $derived(
		[...annotations].filter((a) => !filter || a.label_id === filter).sort(byReadingOrder)
	);

	let cards: Record<string, HTMLElement | undefined> = $state({});

	/**
	 * Which mark this has already revealed.
	 *
	 * Load-bearing. Without it the effect re-ran on every change to `filter` —
	 * which it reads — so choosing a filter that did not match the last mark made
	 * cleared it again immediately, and the filter row simply did not work.
	 * Revealing is a response to a *new* mark, not to the filter changing.
	 */
	let revealed: string | null = $state(null);

	$effect(() => {
		if (!reveal || reveal === untrack(() => revealed)) return;
		revealed = reveal;

		untrack(() => {
			// A filter that would hide the mark just made is dropped rather than
			// obeyed: the reader marked something and it must be there.
			const made = annotations.find((a) => a.id === reveal);
			if (made && filter && made.label_id !== filter) filter = null;

			cards[reveal]?.scrollIntoView({ block: 'nearest' });
		});
	});

	/** Only labels actually used here, so the filter row stays about this paper. */
	const used = $derived(labels.filter((label) => annotations.some((a) => a.label_id === label.id)));

	function labelOf(annotation: Annotation): AnnotationLabel | undefined {
		return labels.find((label) => label.id === annotation.label_id);
	}
</script>

<!--
	On the left, where Zotero puts it and where the toolbar's panel button points.
	A panel that opens on the side opposite its own icon is a small thing that
	makes an interface feel like it was assembled rather than designed.
-->
<aside
	class="bg-surface flex h-full flex-col {embedded
		? 'w-full'
		: 'border-line w-72 shrink-0 border-r'}"
	aria-label="Marks on this paper"
>
	{#if !embedded}
		<div class="border-line flex items-center justify-between border-b px-3 py-2">
			<h2 class="text-ink text-xs font-medium">
				{annotations.length}
				{annotations.length === 1 ? 'mark' : 'marks'}
			</h2>
		</div>
	{/if}

	{#if used.length > 0}
		<div class="border-line flex flex-wrap gap-1 border-b px-3 py-2">
			<button
				class="rounded px-2 py-0.5 text-[11px] {filter === null
					? 'bg-surface-active text-ink'
					: 'text-ink-muted hover:bg-surface-hover'}"
				onclick={() => (filter = null)}>All</button
			>
			{#each used as label (label.id)}
				<button
					class="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] {filter === label.id
						? 'bg-surface-active text-ink'
						: 'text-ink-muted hover:bg-surface-hover'}"
					onclick={() => (filter = filter === label.id ? null : label.id)}
				>
					<span class="inline-block h-2 w-2 rounded-sm" style:background="hsl({label.colour})"
					></span>
					{label.name}
				</button>
			{/each}
		</div>
	{/if}

	<div class="min-h-0 grow overflow-auto">
		{#if shown.length === 0}
			<p class="text-ink-muted p-3 text-xs">
				{annotations.length === 0
					? 'Nothing marked yet. Select a passage to highlight it.'
					: 'No marks with that label.'}
			</p>
		{/if}

		{#each shown as annotation (annotation.id)}
			{@const label = labelOf(annotation)}
			<!--
				A card with the mark's colour down its edge, as Zotero draws them.
				The bar does the work a coloured dot cannot: it ties the card to the
				band of colour on the page at a glance, down a list of thirty.
			-->
			<div
				bind:this={cards[annotation.id]}
				class="border-line bg-surface-sunken group mx-2 my-2 rounded-md border"
				style:border-left="3px solid hsl({label?.colour ?? '45 90% 60%'})"
			>
				<div class="px-2.5 py-2">
					<div class="min-w-0 grow">
						<div class="text-ink-muted flex items-baseline gap-2 text-[11px]">
							<span class="truncate">{label?.name ?? 'Highlight'}</span>
							{#if annotation.origin === 'imported'}
								<!-- Said plainly, so a mark someone else made is never mistaken
								     for one of your own. -->
								<span title="Brought in from another tool">· imported</span>
							{/if}
							<span class="ml-auto shrink-0 tabular-nums">p.&nbsp;{pageLabelOf(annotation)}</span>
						</div>

						<!--
							The paper's words. Quoted, indented behind a rule in the mark's
							own colour, and in the reading face — because the note below is
							yours, and a list where the two look alike is a list you have to
							read twice to use.
						-->
						<button
							class="text-ink hover:text-accent mt-1.5 block w-full border-l-2 pl-2 text-left text-xs italic"
							style:border-color="hsl({label?.colour ?? '45 90% 60%'} / 0.55)"
							onclick={() => onjump(annotation)}
							title="Show this passage in the paper"
						>
							{annotation.quote ?? '(no text)'}
						</button>

						{#if editing === annotation.id}
							<!-- svelte-ignore a11y_autofocus -->
							<textarea
								class="border-line bg-surface-sunken text-ink mt-2 w-full rounded border px-2 py-1 text-xs"
								rows="3"
								autofocus
								value={annotation.note ?? ''}
								onblur={(event) => {
									onnote(annotation, event.currentTarget.value);
									editing = null;
								}}
								onkeydown={(event) => {
									if (event.key === 'Escape') editing = null;
								}}></textarea>
						{:else if annotation.note}
							<!--
								Yours. Upright, on its own ground, and named — so "what the
								paper says" and "what I think about it" are never mistaken for
								each other at a glance.
							-->
							<button
								class="bg-surface hover:bg-surface-hover mt-1.5 block w-full rounded px-2 py-1.5 text-left"
								onclick={() => (editing = annotation.id)}
								title="Edit your note"
							>
								<span class="text-ink-faint mb-0.5 flex items-center gap-1 text-[10px]">
									<Icon icon="Pencil" size="s" />
									Your note
								</span>
								<span class="text-ink block text-xs">{annotation.note}</span>
							</button>
						{/if}

						<div
							class="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
						>
							{#if !annotation.note && editing !== annotation.id}
								<button
									class="text-ink-muted hover:bg-surface-hover rounded p-1"
									onclick={() => (editing = annotation.id)}
									aria-label="Write a note on this mark"
									title="Write a note"
								>
									<Icon icon="Pencil" size="s" />
								</button>
							{/if}

							<select
								class="border-line bg-surface text-ink-muted rounded border px-1 py-0.5 text-[11px]"
								aria-label="Label for this mark"
								value={annotation.label_id ?? ''}
								onchange={(event) => onlabel(annotation, event.currentTarget.value || null)}
							>
								<option value="">No label</option>
								{#each labels as option (option.id)}
									<option value={option.id}>{option.name}</option>
								{/each}
							</select>

							<button
								class="text-ink-muted hover:text-danger hover:bg-surface-hover ml-auto rounded p-1"
								onclick={() => ondelete(annotation.id)}
								aria-label="Delete this mark"
								title="Delete"
							>
								<Icon icon="Trash" size="s" />
							</button>
						</div>
					</div>
				</div>
			</div>
		{/each}
	</div>
</aside>
