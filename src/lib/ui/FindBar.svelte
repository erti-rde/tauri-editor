<script lang="ts">
	import ChevronDown from '~icons/lucide/chevron-down';
	import ChevronRight from '~icons/lucide/chevron-right';
	import ChevronUp from '~icons/lucide/chevron-up';
	import CaseSensitive from '~icons/lucide/case-sensitive';
	import Search from '~icons/lucide/search';
	import WholeWord from '~icons/lucide/whole-word';
	import X from '~icons/lucide/x';

	import Button from './Button.svelte';
	import { controlClass } from './Field.svelte';
	import IconButton from './IconButton.svelte';
	import ToggleButton from './ToggleButton.svelte';

	/**
	 * Find, and replace where the text can be changed (docs/ux.md UX-11). The
	 * searching is the caller's: this is the fields, the count and the keys.
	 *
	 * Enter goes to the next match and Shift Enter the previous; Enter in the
	 * replace field replaces the current one; Esc closes from either. The count
	 * is beside the query, because "3 of 12" is the answer to what was asked.
	 */
	interface Props {
		/** The find field's name, which says what's searched: "Find in this paper". */
		label?: string;
		query?: string;
		/** Where the count stands: "3 of 12", "No matches", or nothing before a query. */
		status: string;
		/** Whether there's a match to go to, or to replace. */
		found: boolean;
		onstep: (direction: 1 | -1) => void;
		onclose: () => void;
		/** The query as it's typed, for a caller that searches as it changes. */
		onquery?: (query: string) => void;
		/** Bound, these show as toggles after the arrows. */
		caseSensitive?: boolean;
		wholeWord?: boolean;
		/** Given, the bar can replace: a disclosure shows the replace row. */
		onreplace?: (text: string) => void;
		onreplaceall?: (text: string) => void;
		/** Whether the replace row shows. ⌘⌥F, or the disclosure, turns it on. */
		replacing?: boolean;
		replacement?: string;
		/** The text can't be changed now (read-only): the replace row is shown but off. */
		readOnly?: boolean;
		/** Pinned over the top of the positioned box it's in, rather than in a toolbar. */
		floating?: boolean;
		side?: 'top' | 'bottom';
	}

	let {
		label = 'Find',
		query = $bindable(''),
		status,
		found,
		onstep,
		onclose,
		onquery,
		caseSensitive = $bindable(),
		wholeWord = $bindable(),
		onreplace,
		onreplaceall,
		replacing = $bindable(false),
		replacement = $bindable(''),
		readOnly = false,
		floating = false,
		side = 'bottom'
	}: Props = $props();

	let input: HTMLInputElement | undefined = $state();

	/** Puts the cursor in the find field, with its words selected to type over. */
	export function focus() {
		input?.focus();
		input?.select();
	}

	function onFindKey(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			onstep(event.shiftKey ? -1 : 1);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
		}
	}

	function onReplaceKey(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			if (found && !readOnly) onreplace?.(replacement);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
		}
	}
</script>

<div
	role="search"
	class={[
		'grid gap-1',
		floating &&
			'bg-surface-raised border-line-strong absolute top-0 left-1/2 z-10 w-[min(34rem,calc(100%-2rem))] -translate-x-1/2 rounded-b-lg border border-t-0 px-2 py-1.5'
	]}
>
	<div class="flex items-center gap-1">
		{#if onreplace}
			<IconButton
				label={replacing ? 'Hide replace' : 'Show replace'}
				shortcut="Mod Alt F"
				icon={replacing ? ChevronDown : ChevronRight}
				aria-expanded={replacing}
				{side}
				onclick={() => (replacing = !replacing)}
			/>
		{/if}
		<div class={['relative', floating ? 'min-w-0 grow' : 'w-56']}>
			<Search
				class="text-ink-faint pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
				aria-hidden="true"
			/>
			<input
				bind:this={input}
				bind:value={query}
				aria-label={label}
				placeholder="Find"
				autocomplete="off"
				spellcheck="false"
				class={[controlClass, 'h-(--row-height) pr-20 pl-7']}
				oninput={() => onquery?.(query)}
				onkeydown={onFindKey}
			/>
			<span
				role="status"
				class="text-caption text-ink-muted pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 whitespace-nowrap tabular-nums"
			>
				{status}
			</span>
		</div>
		<IconButton
			label="Previous match"
			shortcut="Shift Enter"
			icon={ChevronUp}
			disabled={!found}
			{side}
			onclick={() => onstep(-1)}
		/>
		<IconButton
			label="Next match"
			shortcut="Enter"
			icon={ChevronDown}
			disabled={!found}
			{side}
			onclick={() => onstep(1)}
		/>
		{#if caseSensitive !== undefined}
			<ToggleButton
				label="Match case"
				icon={CaseSensitive}
				pressed={caseSensitive}
				{side}
				onclick={() => (caseSensitive = !caseSensitive)}
			/>
		{/if}
		{#if wholeWord !== undefined}
			<ToggleButton
				label="Whole word"
				icon={WholeWord}
				pressed={wholeWord}
				{side}
				onclick={() => (wholeWord = !wholeWord)}
			/>
		{/if}
		<IconButton label="Close find" shortcut="Esc" icon={X} {side} onclick={onclose} />
	</div>
	{#if onreplace && replacing}
		<!-- Under the find field, past the disclosure, so the two fields line up. -->
		<div class="flex items-center gap-1 pl-[calc(var(--row-height)+--spacing(1))]">
			<input
				bind:value={replacement}
				aria-label="Replace with"
				placeholder="Replace with"
				autocomplete="off"
				spellcheck="false"
				disabled={readOnly}
				class={[controlClass, 'h-(--row-height) min-w-0 grow px-2']}
				onkeydown={onReplaceKey}
			/>
			<Button disabled={readOnly || !found} onclick={() => onreplace(replacement)}>Replace</Button>
			<Button disabled={readOnly || !found} onclick={() => onreplaceall?.(replacement)}>
				Replace all
			</Button>
		</div>
	{/if}
</div>
