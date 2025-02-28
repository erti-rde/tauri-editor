<script lang="ts">
	import { createEventDispatcher, onMount, onDestroy } from 'svelte';
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

	import { clickOutside } from '$utils/clickOutside';

	export let mode = 'editor';
	export let editor: Editor;

	const dispatch = createEventDispatcher();
	let isFormatDropdownOpen = false;
	let currentFormat = 'Paragraph';

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
			const level = parseInt(format.slice(1));
			editor.chain().focus().toggleHeading({ level }).run();
		}
		isFormatDropdownOpen = false;
	}

	function switchMode() {
		mode = mode === 'editor' ? 'preview' : 'editor';
		dispatch('switch', { mode });
	}

	function handleExport() {
		dispatch('export');
	}
</script>

<div
	class="flex w-full justify-between bg-orange-100/95 px-2 py-1 shadow-md backdrop-blur-sm"
	style="height: var(--editor-toolbar-height)"
>
	<div class="flex items-center gap-1">
		<!-- History Controls Group -->
		<div class="mr-2 flex gap-1 border-r border-orange-200 pr-2">
			<button
				class="toolbar-btn"
				on:click={() => editor.chain().focus().undo().run()}
				disabled={!editor.can().chain().focus().undo().run()}
			>
				<Undo />
			</button>
			<button
				class="toolbar-btn"
				on:click={() => editor.chain().focus().redo().run()}
				disabled={!editor.can().chain().focus().redo().run()}
			>
				<Redo />
			</button>
		</div>

		<!-- Text Formatting Group -->
		<div class="mr-2 flex gap-1 border-r border-orange-200 pr-2">
			<button
				class="toolbar-btn"
				on:click={() => editor.chain().focus().toggleBold().run()}
				disabled={!editor.can().chain().focus().toggleBold().run()}
				class:is-active={editor.isActive('bold')}
			>
				<Bold />
			</button>
			<button
				class="toolbar-btn"
				on:click={() => editor.chain().focus().toggleItalic().run()}
				disabled={!editor.can().chain().focus().toggleItalic().run()}
				class:is-active={editor.isActive('italic')}
			>
				<Italic />
			</button>
			<button
				class="toolbar-btn"
				on:click={() => editor.chain().focus().toggleStrike().run()}
				disabled={!editor.can().chain().focus().toggleStrike().run()}
				class:is-active={editor.isActive('strike')}
			>
				<StrikeThrough />
			</button>
		</div>

		<!-- Heading Dropdown -->
		<div class="relative mr-2 inline-block border-r border-orange-200 pr-2 text-left">
			<button
				class="inline-flex min-w-[140px] items-center justify-between rounded-md border border-orange-200 px-3 py-1.5 transition-colors hover:bg-orange-200/50 focus:outline-none focus:ring-2 focus:ring-orange-300"
				on:click={toggleFormatDropdown}
			>
				<span class="truncate text-sm font-medium">{currentFormat}</span>
				<Icon icon="ChevronDown" class="ml-2 flex-shrink-0" />
			</button>

			{#if isFormatDropdownOpen}
				<div
					class="absolute left-0 z-50 mt-1 w-[140px] rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5"
					use:clickOutside
					on:outclick={() => (isFormatDropdownOpen = false)}
				>
					<div class="py-1">
						{#each formatOptions as option}
							<button
								class="block w-full px-4 py-2 text-left text-sm transition-colors hover:bg-orange-100"
								class:bg-orange-50={currentFormat === option.label}
								on:click={() => handleFormatSelect(option.value)}
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
			<button
				class="toolbar-btn"
				on:click={() => editor.chain().focus().setTextAlign('left').run()}
				class:is-active={editor.isActive({ textAlign: 'left' })}
			>
				<AlignLeft />
			</button>
			<button
				class="toolbar-btn"
				on:click={() => editor.chain().focus().setTextAlign('center').run()}
				class:is-active={editor.isActive({ textAlign: 'center' })}
			>
				<AlignCenter />
			</button>
			<button
				class="toolbar-btn"
				on:click={() => editor.chain().focus().setTextAlign('right').run()}
				class:is-active={editor.isActive({ textAlign: 'right' })}
			>
				<AlignRight />
			</button>
			<button
				class="toolbar-btn"
				on:click={() => editor.chain().focus().setTextAlign('justify').run()}
				class:is-active={editor.isActive({ textAlign: 'justify' })}
			>
				<AlignJustify />
			</button>
		</div>

		<!-- List Controls Group -->
		<div class="flex gap-1">
			<button
				class="toolbar-btn"
				on:click={() => editor.chain().focus().toggleBulletList().run()}
				class:is-active={editor.isActive('bulletList')}
			>
				<ListUnordered />
			</button>
			<button
				class="toolbar-btn"
				on:click={() => editor.chain().focus().toggleOrderedList().run()}
				class:is-active={editor.isActive('orderedList')}
			>
				<ListOrdered />
			</button>
		</div>
	</div>

	<!-- Right Side Controls -->
	<div class="flex items-center gap-1">
		<button class="toolbar-btn" on:click={switchMode}>
			{#if mode === 'editor'}
				<Icon icon="BookOpen" size="s" />
			{:else}
				<Icon icon="FilePen" size="s" />
			{/if}
		</button>
		<button class="toolbar-btn" on:click={handleExport}>
			<Icon icon="FileOutput" size="s" />
		</button>
	</div>
</div>

<style>
	.toolbar-btn {
		@apply rounded-md p-1.5 transition-colors duration-150 ease-in-out hover:bg-orange-200/50;
		@apply focus:outline-none focus:ring-2 focus:ring-orange-300;
		@apply disabled:cursor-not-allowed disabled:opacity-50;
	}

	.toolbar-btn.is-active {
		@apply bg-orange-200/70 text-orange-800;
	}

	/* Add subtle hover effect for icons */
	:global(.toolbar-btn svg) {
		@apply h-4 w-4;
		@apply transition-transform duration-150;
	}

	:global(.toolbar-btn:hover:not(:disabled) svg) {
		@apply scale-110;
	}

	/* Style for disabled state */
	:global(.toolbar-btn:disabled svg) {
		@apply opacity-50;
	}
</style>
