<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import type { Snippet } from 'svelte';
	import type { Editor } from './Editor';

	type Props = { editor: Editor; class?: string; children?: Snippet };

	const { editor, children, class: className }: Props = $props();
	let element: HTMLElement;

	/**
	 * TipTap 3 widened `options.element` to also allow a `{ mount }` object, a
	 * factory function, or null. Only the plain DOM-element form is meaningful
	 * here, since this component relocates the editor's rendered children.
	 */
	function mountedElement(): Element | null {
		const el = editor?.options.element;
		if (el instanceof Element) return el;
		// TipTap 3 also accepts a `{ mount }` wrapper. The factory and null forms
		// have no element to relocate children from, so they stay unhandled.
		if (el && typeof el === 'object' && 'mount' in el && el.mount instanceof Element) {
			return el.mount;
		}
		return null;
	}

	const init = async () => {
		await tick();
		if (!element) {
			return;
		}

		const current = mountedElement();
		if (!current) {
			return;
		}

		if (editor.contentElement) {
			return;
		}

		// ProseMirror owns this element once mounted, so Svelte must not manage its
		// children. Direct manipulation is required by TipTap's mount contract.
		// eslint-disable-next-line svelte/no-dom-manipulating
		element.append(...Array.from(current.childNodes));
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

		const current = mountedElement();
		if (!current?.firstChild) {
			return;
		}

		const newElement = document.createElement('div');
		newElement.append(...Array.from(current.childNodes));

		editor.setOptions({
			element: newElement
		});
	});
</script>

<div bind:this={element} class={className}></div>

{#if children}
	{@render children()}
{/if}
