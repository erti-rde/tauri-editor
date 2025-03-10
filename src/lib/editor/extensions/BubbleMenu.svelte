<script lang="ts">
	import { onMount } from 'svelte';

	import { Editor, isTextSelection } from '@tiptap/core';
	import { BubbleMenuPlugin } from '@tiptap/extension-bubble-menu';

	import Bold from '~icons/lucide/bold';
	import Italic from '~icons/lucide/italic';
	import Citation from '~icons/lucide/quote';
	import StrikeThrough from '~icons/lucide/strikethrough';

	import type { SvelteComponent } from 'svelte';
	import type { SvelteHTMLElements } from 'svelte/elements';

	interface Props {
		editor: Editor;
		requestCitation: () => void;
	}

	let { editor, requestCitation }: Props = $props();
	let element: HTMLElement;
	const pluginKey = 'SvelteTiptapBubbleMenu';

	onMount(() => {
		const plugin = BubbleMenuPlugin({
			editor,
			element,
			pluginKey,
			shouldShow: ({ editor, view, state, from, to }) => {
				if (editor.isActive('citation')) return false;
				const { doc, selection } = state;
				const { empty } = selection;

				// Sometime check for `empty` is not enough.
				// Doubleclick an empty paragraph returns a node size of 2.
				// So we check also for an empty text size.
				const isEmptyTextBlock =
					!doc.textBetween(from, to).length && isTextSelection(state.selection);

				// When clicking on a element inside the bubble menu the editor "blur" event
				// is called and the bubble menu item is focussed. In this case we should
				// consider the menu as part of the editor and keep showing the menu
				const isChildOfMenu = element.contains(document.activeElement);

				const hasEditorFocus = view.hasFocus() || isChildOfMenu;

				if (!hasEditorFocus || empty || isEmptyTextBlock || !editor.isEditable) {
					return false;
				}

				return true;
			}
		});

		editor.registerPlugin(plugin);

		return () => editor.unregisterPlugin(pluginKey);
	});

	const isActive = (name: string) => editor.isActive(name);

	const bubbleMenuItems = [
		{
			name: 'bold',
			Icon: Bold,
			onclick: () => editor.chain().focus().toggleBold().run()
		},
		{
			name: 'italic',
			Icon: Italic,
			onclick: () => editor.chain().focus().toggleItalic().run()
		},
		{
			name: 'strike',
			Icon: StrikeThrough,
			onclick: () => editor.chain().focus().toggleStrike().run()
		},
		{
			Icon: Citation,
			onclick: requestCitation
		}
	];
</script>

{#snippet BubbleButton({
	name,
	Icon,
	onclick
}: {
	name?: string;
	Icon: typeof SvelteComponent<SvelteHTMLElements['svg']>;
	onclick: () => void;
})}
	<button
		{onclick}
		class={[
			'rounded p-1.5 transition-colors duration-150 ease-in-out hover:bg-orange-100 focus:ring-2 focus:ring-orange-300 focus:outline-none',
			name && isActive(name) && 'bg-orange-200 text-orange-800 hover:bg-orange-300'
		]}
	>
		<Icon class="h-4 w-4" />
	</button>
{/snippet}

<div bind:this={element} style="visibility: hidden;">
	<div
		class="ring-opacity-5 flex items-center gap-1 rounded-lg bg-white px-2 py-1 shadow-lg ring-1 ring-black"
	>
		{#each bubbleMenuItems as { name, Icon, onclick }, i}
			{@render BubbleButton({ name, Icon, onclick })}
		{/each}
	</div>
</div>
