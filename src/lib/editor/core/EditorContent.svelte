<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import type { Snippet } from 'svelte';
	import type { Editor } from './Editor';

	type Props = { editor: Editor; class?: string; children?: Snippet };

	const { editor, children, class: className }: Props = $props();
	let element: HTMLElement;

	const init = async () => {
		await tick();
		if (!element) {
			return;
		}

		if (!editor?.options.element) {
			return;
		}

		if (editor.contentElement) {
			return;
		}

		// ProseMirror owns this element once mounted, so Svelte must not manage its
		// children. Direct manipulation is required by TipTap's mount contract.
		// eslint-disable-next-line svelte/no-dom-manipulating
		element.append(...Array.from(editor.options.element.childNodes));
		editor.setOptions({ element });

		editor.contentElement = element;
	};

	onMount(() => {
		init();
	});

	onDestroy(() => {
		if (!editor) {
			return;
		}

		editor.contentElement = null;

		if (!editor.options.element.firstChild) {
			return;
		}

		const newElement = document.createElement('div');
		newElement.append(...Array.from(editor.options.element.childNodes));

		editor.setOptions({
			element: newElement
		});
	});
</script>

<div bind:this={element} class={className}></div>

{#if children}
	{@render children()}
{/if}
