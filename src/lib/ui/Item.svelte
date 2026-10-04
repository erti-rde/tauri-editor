<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronDown from '~icons/lucide/chevron-down';
	import ChevronUp from '~icons/lucide/chevron-up';

	/**
	 * The row every list shows: a note, a highlight, a search result, a
	 * finding. A meta line (label · source · page), then what it says, then
	 * the passage it quotes, then what can be done with it. One shape, so a
	 * reader learns it once.
	 */
	interface Props {
		/** The line above: `LabelChip` · source · page. */
		meta?: Snippet;
		/** A title line, for a row that is a source. */
		title?: string;
		/** What the row says: a note's text. */
		text?: string;
		/** What the row says, when it's more than text. */
		body?: Snippet;
		/** The passage, set in the page's face, as the page set it. */
		quote?: string;
		/** Shorten a long quote to two lines, with More and Less. */
		clamp?: boolean;
		/** Something to its left: a match's score. */
		leading?: Snippet;
		actions?: Snippet;
	}

	let { meta, title, text, body, quote, clamp = false, leading, actions }: Props = $props();

	let expanded = $state(false);
	const long = $derived(clamp && (quote?.length ?? 0) > 120);
</script>

<div class="border-line flex gap-2.5 border-b px-3 py-2">
	{@render leading?.()}
	<div class="grid min-w-0 flex-1 gap-1">
		{#if meta}
			<div class="text-caption text-ink-muted flex min-w-0 items-center gap-1.5">
				{@render meta()}
			</div>
		{/if}
		{#if title}
			<p class="text-small text-ink font-medium">{title}</p>
		{/if}
		{#if text}
			<p class="text-small text-ink">{text}</p>
		{/if}
		{#if body}
			<div class="text-small text-ink">{@render body()}</div>
		{/if}
		{#if quote}
			<div class="flex items-start gap-2">
				<p
					class={[
						'font-page text-small text-ink-muted flex-1 italic',
						long && !expanded && 'line-clamp-2'
					]}
				>
					{quote}
				</p>
				{#if long}
					<button
						type="button"
						class="text-caption text-ink-muted hover:text-ink flex shrink-0 items-center gap-0.5"
						aria-label={expanded ? 'Show less' : 'Show more'}
						aria-expanded={expanded}
						onclick={() => (expanded = !expanded)}
					>
						{expanded ? 'Less' : 'More'}
						{#if expanded}
							<ChevronUp class="size-3" aria-hidden="true" />
						{:else}
							<ChevronDown class="size-3" aria-hidden="true" />
						{/if}
					</button>
				{/if}
			</div>
		{/if}
		{#if actions}
			<div class="-ml-2 flex flex-wrap items-center gap-1">{@render actions()}</div>
		{/if}
	</div>
</div>
