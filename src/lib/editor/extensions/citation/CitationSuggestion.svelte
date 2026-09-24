<script lang="ts">
	import type { CitationItem } from '$lib/stores/citationStore';
	import { run } from 'svelte/legacy';
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';

	interface Props {
		items: CitationItem[];
		cl: (itemId: string | null) => void;
		initialSelection?: string[];
	}

	let { items, initialSelection = [], cl }: Props = $props();

	// Read once, deliberately — `initialSelection` is the seed, and this set is
	// then the user's own. Re-deriving it would undo their ticks every time the
	// parent re-rendered. `untrack` says so, and silences the warning that would
	// otherwise sit alongside the ones that were real.
	let selectedItems: Set<string> = new SvelteSet(untrack(() => initialSelection));
	let focusedIndex = $state(0);

	// Helper function to check if an item has valid author data
	function hasValidAuthor(
		item: CitationItem
	): item is CitationItem & { author: NonNullable<CitationItem['author']> } {
		return !!(
			item &&
			item.author &&
			Array.isArray(item.author) &&
			item.author.length > 0 &&
			item.author.some((author) => author.given || author.family)
		);
	}

	export function onKeyDown({ event }: { event: KeyboardEvent }) {
		// Prevent default action for navigation keys to avoid editor interaction
		if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
			event.preventDefault();
			event.stopPropagation();
		}

		switch (event.key) {
			case 'ArrowUp':
				focusedIndex = (focusedIndex - 1 + items.length) % items.length;
				scrollToFocusedItem();
				return true;

			case 'ArrowDown':
				focusedIndex = (focusedIndex + 1) % items.length;
				scrollToFocusedItem();
				return true;

			case 'Enter':
				if (items[focusedIndex]) {
					// Only allow selecting items with valid authors
					if (hasValidAuthor(items[focusedIndex])) {
						toggleItemSelection(items[focusedIndex]);
					}
				}
				return true;

			case 'Tab':
				insertSelectedCitations();
				return true;

			case 'Escape':
				// Just return true to let parent component handle closing
				return true;
		}

		return false;
	}

	function scrollToFocusedItem() {
		setTimeout(() => {
			const element = document.getElementById(`citation-item-${focusedIndex}`);
			if (element) {
				element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			}
		}, 0);
	}

	// Toggle selection of an item
	function toggleItemSelection(item: CitationItem) {
		if (!item) return;

		// Don't allow selecting items with invalid authors
		if (!hasValidAuthor(item)) {
			return;
		}

		if (selectedItems.has(item.id)) {
			selectedItems.delete(item.id);
		} else {
			selectedItems.add(item.id);
		}
		// SvelteSet is deeply reactive, so add/delete above already notify subscribers.
		// The old `selectedItems = selectedItems` reassignment was a Svelte 4 idiom and
		// is now a no-op.
	}

	// Insert all selected citations
	function insertSelectedCitations() {
		if (selectedItems.size === 0) {
			cl(null);
			return;
		}

		if (selectedItems.size > 0) {
			const selectedIds = Array.from(selectedItems);
			cl(JSON.stringify(selectedIds));
		}
	}

	function handleKeyDown(event: KeyboardEvent, item: CitationItem) {
		if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			toggleItemSelection(item);
		}
	}
	run(() => {
		if (initialSelection.length > 0 && items.length > 0) {
			// Find the index of the first selected item
			const firstSelectedIndex = items.findIndex((item) => initialSelection.includes(item.id));
			if (firstSelectedIndex >= 0) {
				focusedIndex = firstSelectedIndex;
				// Scroll to this item after render
				setTimeout(() => scrollToFocusedItem(), 0);
			}
		}
	});
</script>

<!-- <NodeViewWrapper> -->
<div
	class="citation-suggestions bg-surface-raised flex w-[380px] flex-col overflow-hidden rounded-lg shadow-md"
	role="dialog"
	aria-label="Citation suggestions"
>
	{#if items.length > 0}
		<div class="list-container max-h-[300px] overflow-y-auto py-2">
			<ul class="m-0 list-none p-0" role="listbox" aria-multiselectable="true">
				{#each items as item, index (index)}
					{@const isInvalid = !hasValidAuthor(item)}
					<li
						id="citation-item-{index}"
						role="option"
						aria-selected={selectedItems.has(item.id)}
						class="cursor-pointer border-l-[3px] px-4 py-3 transition-colors {focusedIndex !== index
							? 'border-transparent'
							: isInvalid
								? 'border-l-danger bg-danger/10'
								: 'border-l-accent bg-accent-quiet'}"
						tabindex="-1"
						onclick={() => toggleItemSelection(item)}
						onkeydown={(e) => handleKeyDown(e, item)}
					>
						<div class="flex items-start gap-3">
							{#if isInvalid}
								<!-- Warning indicator for invalid sources -->
								<div
									class="border-danger text-danger mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2"
									aria-hidden="true"
								>
									<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
										/>
									</svg>
								</div>
							{:else}
								<!-- Normal checkbox for valid sources -->
								<div
									class="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2"
									class:bg-accent={selectedItems.has(item.id)}
									class:border-line-strong={!selectedItems.has(item.id)}
									class:border-accent={selectedItems.has(item.id)}
									aria-hidden="true"
								>
									{#if selectedItems.has(item.id)}
										<svg
											viewBox="0 0 20 20"
											fill="currentColor"
											class="text-accent-ink h-3.5 w-3.5"
										>
											<path
												fill-rule="evenodd"
												d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
												clip-rule="evenodd"
											/>
										</svg>
									{/if}
								</div>
							{/if}

							<div class="flex flex-1 flex-col gap-1">
								<div class="flex items-baseline justify-between">
									<span class="text-ink flex items-center gap-1 font-semibold">
										{#if hasValidAuthor(item)}
											{#each item.author as author, idx (idx)}
												{`${author.given || ''} ${author.family || ''}${idx !== item.author.length - 1 ? ', ' : ''}`}
											{/each}
										{:else}
											<span class="text-danger flex items-center">
												Unknown Author
												<span
													class="border-danger bg-surface-sunken text-danger ml-1 rounded-full border px-1.5 py-0.5 text-xs"
												>
													Missing Data
												</span>
											</span>
										{/if}
									</span>
								</div>
								<span class="text-ink text-[0.95em] leading-relaxed italic">
									{item.title || 'Untitled'}
								</span>

								{#if isInvalid}
									<p class="text-danger mt-1 text-xs">
										This source is missing author information and cannot be cited until the source
										information is updated.
									</p>
								{/if}
							</div>
						</div>
					</li>
				{/each}
			</ul>
		</div>

		<div class="border-line bg-surface-sunken flex items-center justify-between border-t px-4 py-3">
			<div class="text-ink-muted flex gap-3 text-xs">
				<span class="flex items-center gap-1">
					<kbd
						class="border-line-strong bg-surface-sunken inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border px-1 font-mono text-[11px] shadow-sm"
					>
						↵
					</kbd>
					<span>to select</span>
				</span>
				<span class="flex items-center gap-1">
					<kbd
						class="border-line-strong bg-surface-sunken inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border px-1 font-mono text-[11px] shadow-sm"
					>
						Tab
					</kbd>
					<span>to {selectedItems.size > 0 ? 'Insert' : 'Remove'}</span>
				</span>
			</div>
			<div class="flex gap-2">
				<button
					class="focus:ring-opacity-50 text-accent-ink bg-accent disabled:border-line-strong disabled:text-accent-ink border-accent hover:bg-accent-hover focus:ring-accent disabled:bg-surface-sunken rounded border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed"
					disabled={selectedItems.size === 0 && initialSelection.length === 0}
					onclick={insertSelectedCitations}
					aria-label="Insert selected citations"
				>
					{#if initialSelection.length > 0}
						{selectedItems.size > 0 ? 'Insert' : 'Remove'}
					{:else}
						Insert
					{/if}
				</button>
			</div>
		</div>
	{:else}
		<div class="text-ink-muted px-4 py-6 text-center italic">No citations found</div>
	{/if}
</div>

<!-- </NodeViewWrapper> -->

<style>
	/* Custom scrollbar for webkit browsers */
	.list-container::-webkit-scrollbar {
		width: 8px;
	}

	.list-container::-webkit-scrollbar-track {
		background: var(--color-slate-100);
		border-radius: 8px;
	}

	.list-container::-webkit-scrollbar-thumb {
		background-color: var(--color-slate-300);
		border-radius: 8px;
		border: 2px solid var(--color-slate-100);
	}

	.list-container::-webkit-scrollbar-thumb:hover {
		background-color: var(--color-slate-400);
	}
</style>
