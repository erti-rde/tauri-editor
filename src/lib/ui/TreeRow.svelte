<script lang="ts">
	import ChevronDown from '~icons/lucide/chevron-down';
	import ChevronRight from '~icons/lucide/chevron-right';

	import type { IconComponent } from './icon';

	/**
	 * One row of a tree: a file in Files, a heading in Outline. The two used to
	 * be drawn separately, with their own heights, indents and selection; this
	 * gives them one.
	 *
	 * Rows sit flat in their `role="tree"` container and say their depth with
	 * `aria-level`, rather than nesting each branch inside its parent. A row
	 * that holds its children can't also be the thing that's clicked.
	 *
	 * Keys follow the WAI-ARIA tree pattern. Up and Down move between the rows
	 * on screen, and Home and End go to either end. Right opens a branch, or
	 * goes into it when it's open; Left closes it, or goes up to the parent.
	 * Enter, Space and a click choose, and choosing a folder is the caller's to
	 * decide: Files opens and closes it.
	 */
	interface Props {
		/** Depth from 1, for the indent and `aria-level`. */
		level: number;
		label: string;
		icon?: IconComponent;
		/** Open or closed, for a branch. Leave it out for a leaf. */
		expanded?: boolean;
		/** The chosen row: the file that's open. */
		selected?: boolean;
		/** Where you are: the heading the cursor is in. */
		current?: boolean;
		/** A short fact on the right, in words: "open", "you're here", "4". */
		meta?: string;
		/** The row a Tab into the tree lands on. Give it to exactly one. */
		tabbable?: boolean;
		onselect: () => void;
		ontoggle?: () => void;
	}

	let {
		level,
		label,
		icon: Icon,
		expanded,
		selected = false,
		current = false,
		meta,
		tabbable = false,
		onselect,
		ontoggle
	}: Props = $props();

	const branch = $derived(expanded !== undefined);

	function rows(from: HTMLElement): HTMLElement[] {
		const tree = from.closest('[role="tree"]');
		return tree ? [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')] : [from];
	}

	function move(from: HTMLElement, to: HTMLElement | undefined) {
		if (!to || to === from) return;
		to.focus();
	}

	function onkeydown(event: KeyboardEvent) {
		const row = event.currentTarget as HTMLElement;
		const all = rows(row);
		const at = all.indexOf(row);

		switch (event.key) {
			case 'ArrowDown':
				move(row, all[at + 1]);
				break;
			case 'ArrowUp':
				move(row, all[at - 1]);
				break;
			case 'Home':
				move(row, all[0]);
				break;
			case 'End':
				move(row, all.at(-1));
				break;
			case 'ArrowRight':
				if (!branch) return;
				if (expanded) move(row, all[at + 1]);
				else ontoggle?.();
				break;
			case 'ArrowLeft':
				if (branch && expanded) {
					ontoggle?.();
					break;
				}
				// Up to the nearest row above that sits a level higher.
				move(
					row,
					all.slice(0, at).findLast((other) => Number(other.getAttribute('aria-level')) < level)
				);
				break;
			case 'Enter':
			case ' ':
				onselect();
				break;
			default:
				return;
		}
		event.preventDefault();
	}
</script>

<!-- Indented with a style rather than a class: the depth is data, and a class
     would need a number in it. Each level is a chevron's width plus a gap. -->
<div
	role="treeitem"
	aria-level={level}
	aria-expanded={expanded}
	aria-selected={selected}
	aria-current={current ? 'location' : undefined}
	tabindex={tabbable ? 0 : -1}
	style:padding-inline-start="calc(0.375rem + {level - 1} * 1.25rem)"
	class={[
		'text-small focus-inset ease-standard flex h-(--row-height) cursor-default items-center gap-1 pe-2 transition-colors duration-(--duration-fast) select-none',
		selected || current ? 'bg-accent-quiet text-ink' : 'text-ink hover:bg-surface-hover'
	]}
	onclick={onselect}
	{onkeydown}
>
	<span class="text-ink-muted grid size-4 shrink-0 place-items-center" aria-hidden="true">
		{#if branch}
			{#if expanded}
				<ChevronDown class="size-3" />
			{:else}
				<ChevronRight class="size-3" />
			{/if}
		{/if}
	</span>
	{#if Icon}
		<Icon class="text-ink-muted size-3.5 shrink-0" aria-hidden="true" />
	{/if}
	<span class="min-w-0 truncate">{label}</span>
	{#if meta}
		<span class="text-caption text-ink-muted ms-auto shrink-0 ps-2 tabular-nums">{meta}</span>
	{/if}
</div>
