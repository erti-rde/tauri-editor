<script lang="ts">
	import { untrack } from 'svelte';
	import type { Editor } from '@tiptap/core';

	import { FindBar } from '$lib/ui';
	import {
		closeFind,
		findState,
		replaceAll,
		replaceCurrent,
		search,
		step
	} from './extensions/FindReplace';

	/**
	 * Find & replace in the manuscript (M5-2, docs/ux.md UX-11): the `FindBar`
	 * pinned to the top of it, over the `FindReplace` extension that searches.
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
	let caseSensitive = $state(false);
	let wholeWord = $state(false);
	/** What the last Replace all did, said until the search changes. */
	let replaced: number | null = $state(null);
	let bar: FindBar | undefined = $state();

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

	const status = $derived.by(() => {
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
		bar?.focus();
	}

	$effect(() => {
		// On opening; `focus` again on ⌘F while open.
		bar?.focus();
	});

	function close() {
		closeFind(editor.view);
		editor.commands.focus();
		onclose();
	}
</script>

<FindBar
	bind:this={bar}
	bind:query
	bind:caseSensitive
	bind:wholeWord
	bind:replacing
	label="Find"
	floating
	{status}
	{readOnly}
	found={found.matches.length > 0}
	onstep={(direction) => step(editor.view, direction)}
	onclose={close}
	onreplace={(text) => replaceCurrent(editor.view, text)}
	onreplaceall={(text) => (replaced = replaceAll(editor.view, text))}
/>
