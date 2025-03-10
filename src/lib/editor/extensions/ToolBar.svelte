<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { type Editor } from '@tiptap/core';

	// Import Icons for toolbar
	import Bold from '~icons/lucide/bold';
	import Italic from '~icons/lucide/italic';
	import StrikeThrough from '~icons/lucide/strikethrough';
	import ListUnordered from '~icons/lucide/list';
	import ListOrdered from '~icons/lucide/list-ordered';
	import Undo from '~icons/lucide/undo-2';
	import Redo from '~icons/lucide/redo-2';
	import AlignLeft from '~icons/lucide/align-left';
	import AlignRight from '~icons/lucide/align-right';
	import AlignCenter from '~icons/lucide/align-center';
	import AlignJustify from '~icons/lucide/align-justify';

	import { Icon } from '$lib';

	import { clickOutside } from '$utils/clickOutside.svelte';
	import type { SvelteComponent } from 'svelte';
	import type { SvelteHTMLElements } from 'svelte/elements';

	interface Props {
		editor: Editor;
		toggleView: () => void;
		exportToPdf: () => void;
	}

	let { editor, toggleView, exportToPdf }: Props = $props();

	let isFormatDropdownOpen = $state(false);
	let currentFormat = $state('Paragraph');

	const formatOptions = [
		{ label: 'Paragraph', value: 'paragraph' },
		{ label: 'Heading 1', value: 'h1' },
		{ label: 'Heading 2', value: 'h2' },
		{ label: 'Heading 3', value: 'h3' }
	];

	function updateCurrentFormat() {
		if (editor.isActive('paragraph')) {
			currentFormat = 'Paragraph';
		} else {
			for (let i = 1; i <= 3; i++) {
				if (editor.isActive('heading', { level: i })) {
					currentFormat = `Heading ${i}`;
					break;
				}
			}
		}
	}
	onMount(() => {
		if (editor) {
			editor.on('selectionUpdate', updateCurrentFormat);
			editor.on('update', updateCurrentFormat);
		}
	});

	onDestroy(() => {
		if (editor) {
			editor.off('selectionUpdate', updateCurrentFormat);
			editor.off('update', updateCurrentFormat);
		}
	});
	function toggleFormatDropdown() {
		isFormatDropdownOpen = !isFormatDropdownOpen;
	}

	function handleFormatSelect(format: string) {
		if (format === 'paragraph') {
			editor.chain().focus().setParagraph().run();
		} else {
			const level = parseInt(format.slice(1)) as 1 | 2 | 3;
			editor.chain().focus().toggleHeading({ level }).run();
		}
		isFormatDropdownOpen = false;
	}
</script>

{#snippet toolBarButton({
	onclick,
	disabled,
	isActive,
	Icon
}: {
	onclick: () => void;
	disabled?: boolean;
	isActive?: boolean;
	Icon: typeof SvelteComponent<SvelteHTMLElements['svg']>;
})}
	<button
		class={[
			'rounded-md p-1.5 transition-colors duration-150 ease-in-out hover:bg-orange-200/50 focus:ring-2 focus:ring-orange-300 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
			isActive && 'bg-orange-200/70 text-orange-800'
		]}
		{onclick}
		{disabled}
	>
		<Icon />
	</button>
{/snippet}

<div
	class="flex w-full justify-between bg-orange-100/95 px-2 py-1 shadow-md backdrop-blur-sm"
	style="height: var(--editor-toolbar-height)"
>
	<div class="flex items-center gap-1">
		<!-- History Controls Group -->
		<div class="mr-2 flex gap-1 border-r border-orange-200 pr-2">
			{@render toolBarButton({
				onclick: () => editor.chain().focus().undo().run(),
				disabled: !editor.can().undo(),
				Icon: Undo
			})}
			{@render toolBarButton({
				onclick: () => editor.chain().focus().redo().run(),
				disabled: !editor.can().redo(),
				Icon: Redo
			})}
		</div>

		<!-- Text Formatting Group -->
		<div class="mr-2 flex gap-1 border-r border-orange-200 pr-2">
			{@render toolBarButton({
				onclick: () => editor.chain().focus().toggleBold().run(),
				disabled: !editor.can().chain().focus().toggleBold().run(),
				Icon: Bold
			})}
			{@render toolBarButton({
				onclick: () => editor.chain().focus().toggleItalic().run(),
				disabled: !editor.can().chain().focus().toggleItalic().run(),
				Icon: Italic
			})}
			{@render toolBarButton({
				onclick: () => editor.chain().focus().toggleStrike().run(),
				disabled: !editor.can().chain().focus().toggleStrike().run(),
				Icon: StrikeThrough
			})}
		</div>

		<!-- Heading Dropdown -->
		<div class="relative mr-2 inline-block border-r border-orange-200 pr-2 text-left">
			<button
				class="inline-flex min-w-[140px] items-center justify-between rounded-md border border-orange-200 px-3 py-1.5 transition-colors hover:bg-orange-200/50 focus:ring-2 focus:ring-orange-300 focus:outline-none"
				onclick={toggleFormatDropdown}
			>
				<span class="truncate text-sm font-medium">{currentFormat}</span>
				<Icon icon="ChevronDown" />
			</button>

			{#if isFormatDropdownOpen}
				<div
					class="ring-opacity-5 absolute left-0 z-50 mt-1 w-[140px] rounded-md bg-white shadow-lg ring-1 ring-black"
					use:clickOutside
					onoutclick={toggleFormatDropdown}
				>
					<div class="py-1">
						{#each formatOptions as option}
							<button
								class="block w-full px-4 py-2 text-left text-sm transition-colors hover:bg-orange-100"
								class:bg-orange-50={currentFormat === option.label}
								onclick={() => handleFormatSelect(option.value)}
							>
								{option.label}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- Alignment Group -->
		<div class="mr-2 flex gap-1 border-r border-orange-200 pr-2">
			{@render toolBarButton({
				onclick: () => editor.chain().focus().setTextAlign('left').run(),
				isActive: editor.isActive({ textAlign: 'left' }),
				Icon: AlignLeft
			})}
			{@render toolBarButton({
				onclick: () => editor.chain().focus().setTextAlign('center').run(),
				isActive: editor.isActive({ textAlign: 'center' }),
				Icon: AlignCenter
			})}
			{@render toolBarButton({
				onclick: () => editor.chain().focus().setTextAlign('right').run(),
				isActive: editor.isActive({ textAlign: 'right' }),
				Icon: AlignRight
			})}
			{@render toolBarButton({
				onclick: () => editor.chain().focus().setTextAlign('justify').run(),
				isActive: editor.isActive({ textAlign: 'justify' }),
				Icon: AlignJustify
			})}
		</div>

		<!-- List Controls Group -->
		<div class="flex gap-1">
			{@render toolBarButton({
				onclick: () => editor.chain().focus().toggleBulletList().run(),
				isActive: editor.isActive('bulletList'),
				Icon: ListUnordered
			})}
			{@render toolBarButton({
				onclick: () => editor.chain().focus().toggleOrderedList().run(),
				isActive: editor.isActive('orderedList'),
				Icon: ListOrdered
			})}
		</div>
	</div>

	<!-- Right Side Controls -->
	<div class="flex items-center gap-1">
		<button class="toolbar-btn" onclick={toggleView}>
			{#if editor.isEditable}
				<Icon icon="BookOpen" size="s" />
			{:else}
				<Icon icon="FilePen" size="s" />
			{/if}
		</button>
		<button class="toolbar-btn" onclick={exportToPdf}>
			<Icon icon="FileOutput" size="s" />
		</button>
	</div>
</div>
