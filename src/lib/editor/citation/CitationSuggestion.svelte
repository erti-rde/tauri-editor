<script lang="ts">
	import type { CitationItem } from '$lib/stores/citationStore';

	export let items: CitationItem[];
	export let command: (props: { id: string }) => string;
	export let initialSelection: string[] = [];

	let selectedItems: Set<string> = new Set(initialSelection);
	// Track current keyboard focus index
	let focusedIndex = 0;
	$: {
		if (initialSelection.length > 0 && items.length > 0) {
			// Find the index of the first selected item
			const firstSelectedIndex = items.findIndex((item) => initialSelection.includes(item.id));
			if (firstSelectedIndex >= 0) {
				focusedIndex = firstSelectedIndex;
				// Scroll to this item after render
				setTimeout(() => scrollToFocusedItem(), 0);
			}
		}
	}
	// Handle keyboard navigation
	export function onKeyDown({ event }: { event: KeyboardEvent }) {
		console.log({ event });
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
					toggleItemSelection(items[focusedIndex]);
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

	// Scroll to ensure the focused item is visible
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

		if (selectedItems.has(item.id)) {
			selectedItems.delete(item.id);
		} else {
			selectedItems.add(item.id);
		}
		selectedItems = selectedItems; // Trigger reactivity
	}

	// Insert all selected citations
	function insertSelectedCitations() {
		if (selectedItems.size === 0 && items[focusedIndex]) {
			// If no items are selected, select the currently focused one
			selectedItems.add(items[focusedIndex].id);
		}

		if (selectedItems.size > 0) {
			// Convert the Set to an Array for processing
			const selectedIds = Array.from(selectedItems);
			command({ id: JSON.stringify(selectedIds) });
		}
	}

	function handleKeyDown(event: KeyboardEvent, item: CitationItem) {
		if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			toggleItemSelection(item);
		}
	}
</script>

<div
	class="citation-suggestions flex w-[380px] flex-col overflow-hidden rounded-lg bg-white shadow-md"
	role="dialog"
	aria-label="Citation suggestions"
>
	{#if items.length > 0}
		<div class="list-container max-h-[300px] overflow-y-auto py-2">
			<ul class="m-0 list-none p-0" role="listbox" aria-multiselectable="true">
				{#each items as item, index (item.id)}
					<li
						id="citation-item-{index}"
						role="option"
						aria-selected={selectedItems.has(item.id)}
						class="cursor-pointer border-l-[3px] border-transparent px-4 py-3 transition-colors"
						class:bg-teal-50={focusedIndex === index}
						class:border-l-teal-500={focusedIndex === index}
						tabindex="-1"
						on:click={() => toggleItemSelection(item)}
						on:keydown={(e) => handleKeyDown(e, item)}
					>
						<div class="flex items-start gap-3">
							<div
								class="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2"
								class:bg-teal-500={selectedItems.has(item.id)}
								class:border-slate-300={!selectedItems.has(item.id)}
								class:border-teal-500={selectedItems.has(item.id)}
								aria-hidden="true"
							>
								{#if selectedItems.has(item.id)}
									<svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5 text-white">
										<path
											fill-rule="evenodd"
											d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
											clip-rule="evenodd"
										/>
									</svg>
								{/if}
							</div>
							<div class="flex flex-1 flex-col gap-1">
								<div class="flex items-baseline justify-between">
									<span class="font-semibold text-gray-900">
										{#if item && item.author}
											{#each item.author as author, index}
												{`${author.given} ${author.family}${index !== item.author.length - 1 ? ', ' : ''}`}
											{/each}
										{:else}
											Unknown Author
										{/if}
									</span>
								</div>
								<span class="text-[0.95em] italic leading-relaxed text-gray-700">
									{item.title || 'Untitled'}
								</span>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		</div>

		<div class="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
			<div class="flex gap-3 text-xs text-gray-600">
				<span class="flex items-center gap-1">
					<kbd
						class="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-slate-300 bg-slate-100 px-1 font-mono text-[11px] shadow-sm"
					>
						↵
					</kbd>
					<span>to select</span>
				</span>
				<span class="flex items-center gap-1">
					<kbd
						class="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-slate-300 bg-slate-100 px-1 font-mono text-[11px] shadow-sm"
					>
						Tab
					</kbd>
					<span>to insert</span>
				</span>
			</div>
			<button
				class="rounded border border-teal-600 bg-teal-500 px-3 py-1.5 text-sm font-medium text-white transition-colors
				hover:bg-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-opacity-50
				disabled:cursor-not-allowed disabled:border-slate-400 disabled:bg-slate-300 disabled:text-slate-50"
				disabled={selectedItems.size === 0 && !items[focusedIndex]}
				on:click={insertSelectedCitations}
				aria-label="Insert selected citations"
			>
				Insert
			</button>
		</div>
	{:else}
		<div class="px-4 py-6 text-center italic text-gray-500">No citations found</div>
	{/if}
</div>

<style>
	/* Custom scrollbar for webkit browsers */
	.list-container::-webkit-scrollbar {
		width: 8px;
	}

	.list-container::-webkit-scrollbar-track {
		background: theme('colors.slate.100');
		border-radius: 8px;
	}

	.list-container::-webkit-scrollbar-thumb {
		background-color: theme('colors.slate.300');
		border-radius: 8px;
		border: 2px solid theme('colors.slate.100');
	}

	.list-container::-webkit-scrollbar-thumb:hover {
		background-color: theme('colors.slate.400');
	}
</style>
