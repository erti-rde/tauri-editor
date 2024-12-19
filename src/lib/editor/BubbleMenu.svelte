<script lang="ts">
	import { onMount } from 'svelte';

	import type { Editor } from '@tiptap/core';

	import Bold from '~icons/lucide/bold';
	import Italic from '~icons/lucide/italic';
	import StrikeThrough from '~icons/lucide/strikethrough';

	import { BubbleMenuPlugin } from '@tiptap/extension-bubble-menu';

	export let editor: Editor;
	let element: HTMLElement;
	const pluginKey = 'SvelteTiptapBubbleMenu';
	onMount(() => {
		const plugin = BubbleMenuPlugin({
			editor,
			element,
			pluginKey
		});

		editor.registerPlugin(plugin);

		return () => editor.unregisterPlugin(pluginKey);
	});
</script>

<div bind:this={element} style="visibility: hidden;">
	<div
		class="flex items-center gap-1 rounded-lg bg-white px-2 py-1 shadow-lg ring-1 ring-black ring-opacity-5"
	>
		<button
			class="bubble-btn"
			class:is-active={editor.isActive('bold')}
			on:click={() => editor.chain().focus().toggleBold().run()}
		>
			<Bold class="h-4 w-4" />
		</button>

		<button
			class="bubble-btn"
			class:is-active={editor.isActive('italic')}
			on:click={() => editor.chain().focus().toggleItalic().run()}
		>
			<Italic class="h-4 w-4" />
		</button>

		<button
			class="bubble-btn"
			class:is-active={editor.isActive('strike')}
			on:click={() => editor.chain().focus().toggleStrike().run()}
		>
			<StrikeThrough class="h-4 w-4" />
		</button>
	</div>
</div>

<style>
	.bubble-btn {
		@apply rounded p-1.5 transition-colors duration-150 ease-in-out hover:bg-gray-100;
		@apply focus:outline-none focus:ring-2 focus:ring-orange-300;
	}

	.bubble-btn.is-active {
		@apply bg-orange-100 text-orange-800;
	}
</style>
