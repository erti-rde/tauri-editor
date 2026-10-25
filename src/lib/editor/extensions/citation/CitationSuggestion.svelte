<script lang="ts">
	import type { CitationItem } from '$lib/stores/citationStore';
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import TriangleAlert from '~icons/lucide/triangle-alert';

	import { Button, Combobox, EmptyState, Kbd } from '$lib/ui';

	interface Props {
		items: CitationItem[];
		cl: (itemId: string | null) => void;
		initialSelection?: string[];
		/** What's been typed after the `@`, to say what didn't match. */
		query?: string;
		/** The manuscript, which keeps focus while this is open. */
		owner?: HTMLElement | null;
	}

	let { items, initialSelection = [], cl, query = '', owner = null }: Props = $props();

	// Escape hides the picker but leaves it mounted until the caret moves on.
	// From then the keys are the manuscript's again, and the manuscript stops
	// saying it controls a list nobody can see.
	let dismissed = $state(false);

	export function dismiss() {
		dismissed = true;
	}

	// Read once, deliberately — `initialSelection` is the seed, and this set is
	// then the user's own. Re-deriving it would undo their ticks every time the
	// parent re-rendered. `untrack` says so, and silences the warning that would
	// otherwise sit alongside the ones that were real.
	const selectedItems = new SvelteSet<string>(untrack(() => initialSelection));

	// Editing a citation opens on the first work it cites, not the top of the list.
	let activeIndex = $state(
		untrack(() =>
			Math.max(
				0,
				items.findIndex((item) => initialSelection.includes(item.id))
			)
		)
	);

	let combobox = $state<ReturnType<typeof Combobox<CitationItem>>>();

	/**
	 * Whether a source has an author to cite it by. An organisation counts: CSL
	 * names one in `literal`, and citeproc cites it by that.
	 */
	function hasValidAuthor(item: CitationItem): boolean {
		return !!item.author?.some((author) => author.given || author.family || author.literal);
	}

	/** "Vaswani et al. · 2017": who and when, as a reader looks a work up. */
	function sourceLine(item: CitationItem): string {
		const names = (item.author ?? [])
			.map((author) => author.family || author.literal || author.given)
			.filter(Boolean);
		const who =
			names.length > 2
				? `${names[0]} et al.`
				: names.length === 2
					? `${names[0]} and ${names[1]}`
					: names[0];
		const year = item.issued?.['date-parts']?.[0]?.[0];
		return [who, year].filter(Boolean).join(' · ');
	}

	export function onKeyDown({ event }: { event: KeyboardEvent }) {
		// An input method's Enter confirms what's being composed (see `Combobox`).
		if (dismissed || event.isComposing || event.keyCode === 229) return false;

		// These are the picker's while it's open, never the manuscript's: Enter
		// would split the paragraph and Tab would leave the editor.
		if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
			event.preventDefault();
			event.stopPropagation();
		}

		switch (event.key) {
			case 'Tab':
				insertSelectedCitations();
				return true;
			case 'Escape':
				// The parent closes it.
				return true;
		}

		return combobox?.keydown(event) ?? false;
	}

	function toggleItemSelection(item: CitationItem) {
		if (selectedItems.has(item.id)) selectedItems.delete(item.id);
		else selectedItems.add(item.id);
	}

	function insertSelectedCitations() {
		cl(selectedItems.size ? JSON.stringify(Array.from(selectedItems)) : null);
	}

	// Editing a citation and unticking everything removes it, so the button
	// says so.
	const verb = $derived(
		selectedItems.size === 0 && initialSelection.length > 0 ? 'Remove' : 'Insert'
	);
</script>

<Combobox
	bind:this={combobox}
	bind:activeIndex
	label="Citation suggestions"
	{items}
	key={(item) => item.id}
	owner={dismissed ? null : owner}
	multiple
	selected={(item) => selectedItems.has(item.id)}
	disabled={(item) => !hasValidAuthor(item)}
	onchoose={toggleItemSelection}
>
	{#snippet option({ item, disabled })}
		<span class="font-medium">{item.title || 'Untitled'}</span>
		{#if disabled}
			<!-- The icon and the words both say it; the colour only adds to them. -->
			<span class="text-caption text-ink-muted flex items-start gap-1">
				<TriangleAlert class="text-danger mt-px size-3.5 shrink-0" aria-hidden="true" />
				No author, so it can't be cited yet. Add one in the metadata explorer.
			</span>
		{:else}
			<span class="text-caption text-ink-muted">{sourceLine(item)}</span>
		{/if}
	{/snippet}

	{#snippet empty()}
		{#if query}
			<EmptyState message="No sources match “{query}”." />
		{:else}
			<EmptyState
				message="There are no sources to cite yet."
				detail="Add papers to the project, or import a bibliography, and they'll be offered here."
			/>
		{/if}
	{/snippet}

	{#snippet footer()}
		<span class="flex items-center gap-1"><Kbd keys="↑" /><Kbd keys="↓" /> move</span>
		<span class="flex items-center gap-1"><Kbd keys="Enter" /> select</span>
		<span class="flex items-center gap-1"><Kbd keys="Tab" /> {verb.toLowerCase()}</span>
		<Button
			variant="primary"
			size="sm"
			class="ml-auto"
			disabled={selectedItems.size === 0 && initialSelection.length === 0}
			onclick={insertSelectedCitations}
		>
			{verb}
		</Button>
	{/snippet}
</Combobox>
