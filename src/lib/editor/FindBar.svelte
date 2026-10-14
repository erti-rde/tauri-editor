<script lang="ts">
	import { untrack } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import ArrowDown from '~icons/lucide/arrow-down';
	import ArrowUp from '~icons/lucide/arrow-up';
	import CaseSensitive from '~icons/lucide/case-sensitive';
	import Replace from '~icons/lucide/replace';
	import WholeWord from '~icons/lucide/whole-word';
	import X from '~icons/lucide/x';

	import { Button, IconButton, TextField } from '$lib/ui';
	import {
		closeFind,
		findState,
		replaceAll,
		replaceCurrent,
		search,
		step
	} from './extensions/FindReplace';

	/**
	 * The find & replace bar (M5-2, docs/ux.md UX-11), pinned to the top of the
	 * manuscript. The searching is in the `FindReplace` extension; this is the
	 * fields, the count and the keys.
	 */
	interface Props {
		editor: Editor;
		/** Whether the replace field shows. ⌘⌥F turns it on. */
		replacing: boolean;
		/**
		 * Whether the document can't be edited: open from a newer Erti, or in
		 * reading view. A prop because Tiptap's `setEditable` dispatches no
		 * transaction, so the bar can't see it change by watching the editor.
		 */
		readOnly?: boolean;
		onclose: () => void;
	}

	let { editor, replacing = $bindable(), readOnly = false, onclose }: Props = $props();

	let query = $state(initialQuery());
	let replacement = $state('');
	let caseSensitive = $state(false);
	let wholeWord = $state(false);
	/** What the last Replace all did, said until the search changes. */
	let replaced: number | null = $state(null);
	let bar: HTMLElement | undefined = $state();

	// The extension's state changes with every transaction, typing included.
	let version = $state(0);
	$effect(() => {
		const bump = () => version++;
		editor.on('transaction', bump);
		return () => editor.off('transaction', bump);
	});
	const found = $derived.by(() => {
		void version;
		return findState(editor.state);
	});

	$effect(() => {
		const [text, options] = [query, { caseSensitive, wholeWord }];
		// Searching dispatches, which counts a transaction: untracked, or this
		// effect would depend on the count it moves.
		untrack(() => search(editor.view, text, options));
		replaced = null;
	});

	// Closing however it closes (Esc, the button, the editor going away) clears
	// the highlights, which would otherwise outlive the bar.
	$effect(() => () => {
		if (!editor.isDestroyed) closeFind(editor.view);
	});

	const count = $derived.by(() => {
		if (replaced !== null) return `Replaced ${replaced.toLocaleString('en-GB')}`;
		if (query === '') return '';
		if (found.matches.length === 0) return 'No matches';
		const total = found.matches.length.toLocaleString('en-GB');
		return `${(found.current + 1).toLocaleString('en-GB')} of ${total}`;
	});

	/**
	 * Words selected in one paragraph are what's looked for, as in most
	 * editors. More than a line is a passage being worked on, not a query.
	 */
	function initialQuery() {
		const { from, to, empty } = editor.state.selection;
		if (empty) return '';
		const text = editor.state.doc.textBetween(from, to, '\n');
		return text.includes('\n') || text.length > 100 ? '' : text;
	}

	/** Puts the cursor in the find field, with its words selected to type over. */
	export function focus() {
		const input = bar?.querySelector<HTMLInputElement>('input');
		input?.focus();
		input?.select();
	}

	$effect(() => {
		// On opening; `focus` again on ⌘F while open.
		focus();
	});

	function close() {
		closeFind(editor.view);
		editor.commands.focus();
		onclose();
	}

	function onFindKey(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			step(editor.view, event.shiftKey ? -1 : 1);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			close();
		}
	}

	function onReplaceKey(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			replaceCurrent(editor.view, replacement);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			close();
		}
	}
</script>

<div
	bind:this={bar}
	role="search"
	aria-label="Find in the manuscript"
	class="bg-surface-raised border-line-strong absolute top-0 left-1/2 z-10 grid -translate-x-1/2 gap-1 rounded-b border border-t-0 px-2 py-1.5"
>
	<div class="flex items-center gap-1">
		<TextField
			label="Find"
			hideLabel
			placeholder="Find"
			bind:value={query}
			onkeydown={onFindKey}
			autocomplete="off"
			spellcheck="false"
			class="w-48"
		/>
		<span
			role="status"
			class="text-caption text-ink-muted min-w-16 px-1 text-center whitespace-nowrap tabular-nums"
		>
			{count}
		</span>
		<IconButton
			label="Previous match"
			shortcut="Shift Enter"
			icon={ArrowUp}
			disabled={found.matches.length === 0}
			onclick={() => step(editor.view, -1)}
		/>
		<IconButton
			label="Next match"
			shortcut="Enter"
			icon={ArrowDown}
			disabled={found.matches.length === 0}
			onclick={() => step(editor.view, 1)}
		/>
		<IconButton
			label="Match case"
			icon={CaseSensitive}
			pressed={caseSensitive}
			onclick={() => (caseSensitive = !caseSensitive)}
		/>
		<IconButton
			label="Whole word"
			icon={WholeWord}
			pressed={wholeWord}
			onclick={() => (wholeWord = !wholeWord)}
		/>
		<IconButton
			label="Replace"
			shortcut="Mod Alt F"
			icon={Replace}
			pressed={replacing}
			onclick={() => (replacing = !replacing)}
		/>
		<IconButton label="Close find" shortcut="Esc" icon={X} onclick={close} />
	</div>
	{#if replacing}
		<div class="flex items-center gap-1">
			<TextField
				label="Replace with"
				hideLabel
				placeholder="Replace with"
				bind:value={replacement}
				onkeydown={onReplaceKey}
				autocomplete="off"
				spellcheck="false"
				disabled={readOnly}
				class="w-48"
			/>
			<Button
				disabled={readOnly || found.matches.length === 0}
				onclick={() => replaceCurrent(editor.view, replacement)}
			>
				Replace
			</Button>
			<Button
				disabled={readOnly || found.matches.length === 0}
				onclick={() => (replaced = replaceAll(editor.view, replacement))}
			>
				Replace all
			</Button>
		</div>
	{/if}
</div>
