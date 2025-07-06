<script lang="ts">
	import type { SvelteComponent } from 'svelte';
	import type { SvelteHTMLElements } from 'svelte/elements';
	import { type Editor } from '@tiptap/core';

	import { open } from '@tauri-apps/plugin-dialog';
	import { convertFileSrc } from '@tauri-apps/api/core';

	import { Separator, Popover, Toggle } from 'bits-ui';
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
	import Heading from '~icons/lucide/heading';
	import Heading1 from '~icons/lucide/heading-1';
	import Heading2 from '~icons/lucide/heading-2';
	import Heading3 from '~icons/lucide/heading-3';
	import Blockquote from '~icons/lucide/text-quote';
	import CodeBlock from '~icons/lucide/square-code';
	import InlineCode from '~icons/lucide/code-xml';
	import Underline from '~icons/lucide/underline';
	import Highlighter from '~icons/lucide/highlighter';
	import Subscript from '~icons/lucide/subscript';
	import Superscript from '~icons/lucide/superscript';
	import Image from '~icons/lucide/image-plus';
	import Table from '~icons/lucide/table';
	import Link from '~icons/lucide/link';

	import Dropdown from '$lib/ui/Dropdown.svelte';
	import LinkPopover from './LinkPopover.svelte';
	import TablePopover from './TablePopover.svelte';

	interface Props {
		editor: Editor;
		toggleView: () => void;
		exportToPdf: () => void;
	}

	let { editor, toggleView, exportToPdf }: Props = $props();

	function handleFormatSelect(format: string) {
		if (format === 'paragraph') {
			editor.chain().focus().setParagraph().run();
		} else {
			const level = parseInt(format.slice(1)) as 1 | 2 | 3;
			editor.chain().focus().toggleHeading({ level }).run();
		}
	}

	async function addImage() {
		const selectedFile = await open({
			multiple: false
		});
		console.log('Selected file:', selectedFile);
		if (selectedFile) {
			const imageUrl = typeof selectedFile === 'string' ? selectedFile : selectedFile[0];
			const convertedUrl = convertFileSrc(imageUrl);
			editor.chain().focus().setImage({ src: convertedUrl }).run();
		}
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
			isActive && 'bg-orange-200/70 text-orange-600'
		]}
		{onclick}
		{disabled}
	>
		<Icon />
	</button>
{/snippet}

<div
	class="flex h-(--toolbar-l) w-full justify-center bg-orange-100/95 px-2 py-1 shadow-md backdrop-blur-sm"
>
	<!-- History Controls Group -->

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

	<Separator.Root class="mx-1 my-1 w-[1px] self-stretch bg-orange-200" />

	{#snippet defaultHeadingButton()}
		<Heading class="ml-1" />
	{/snippet}

	{#snippet defaultListButtons()}
		<ListUnordered class="ml-1" />
	{/snippet}

	<Dropdown
		buttonText={defaultHeadingButton}
		items={[
			{
				label: 'Heading 1',
				icon: Heading1,
				isActive: editor.isActive('heading', { level: 1 }),
				callBack: () => handleFormatSelect('h1')
			},
			{
				label: 'Heading 2',
				icon: Heading2,
				isActive: editor.isActive('heading', { level: 2 }),
				callBack: () => handleFormatSelect('h2')
			},
			{
				label: 'Heading 3',
				icon: Heading3,
				isActive: editor.isActive('heading', { level: 3 }),
				callBack: () => handleFormatSelect('h3')
			}
		]}
	/>

	<Dropdown
		buttonText={defaultListButtons}
		items={[
			{
				label: 'Bullet List',
				icon: ListUnordered,
				isActive: editor.isActive('bulletList'),
				callBack: () => editor.chain().focus().toggleBulletList().run()
			},
			{
				label: 'Ordered List',
				icon: ListOrdered,
				isActive: editor.isActive('orderedList'),
				callBack: () => editor.chain().focus().toggleOrderedList().run()
			}
		]}
	/>

	{@render toolBarButton({
		onclick: () => editor.chain().focus().toggleBlockquote().run(),
		isActive: editor.isActive('blockquote'),
		disabled: !editor.can().chain().focus().toggleBlockquote().run(),
		Icon: Blockquote
	})}
	{@render toolBarButton({
		onclick: () => editor.chain().focus().toggleCodeBlock().run(),
		isActive: editor.isActive('codeBlock'),
		disabled: !editor.can().chain().focus().toggleCodeBlock().run(),
		Icon: CodeBlock
	})}

	<Separator.Root class="mx-1 my-1 w-[1px] self-stretch bg-orange-200" />

	<!-- Text Formatting Group -->
	{@render toolBarButton({
		onclick: () => editor.chain().focus().toggleBold().run(),
		isActive: editor.isActive('bold'),
		disabled: !editor.can().chain().focus().toggleBold().run(),
		Icon: Bold
	})}
	{@render toolBarButton({
		onclick: () => editor.chain().focus().toggleItalic().run(),
		isActive: editor.isActive('italic'),
		disabled: !editor.can().chain().focus().toggleItalic().run(),
		Icon: Italic
	})}
	{@render toolBarButton({
		onclick: () => editor.chain().focus().toggleStrike().run(),
		isActive: editor.isActive('strike'),
		disabled: !editor.can().chain().focus().toggleStrike().run(),
		Icon: StrikeThrough
	})}
	{@render toolBarButton({
		onclick: () => editor.chain().focus().toggleUnderline().run(),
		isActive: editor.isActive('underline'),
		disabled: !editor.can().chain().focus().toggleUnderline().run(),
		Icon: Underline
	})}
	{@render toolBarButton({
		onclick: () => editor.chain().focus().toggleCode().run(),
		isActive: editor.isActive('code'),
		disabled: !editor.can().chain().focus().toggleCode().run(),
		Icon: InlineCode
	})}
	{@render toolBarButton({
		onclick: () => editor.chain().focus().toggleHighlight().run(),
		isActive: editor.isActive('highlight'),
		disabled: !editor.can().chain().focus().toggleHighlight().run(),
		Icon: Highlighter
	})}

	<!-- Configure Link -->

	<LinkPopover {editor} isActive={editor.isActive('link')}>
		{@render toolBarButton({
			onclick: () => null,
			Icon: Link
		})}
	</LinkPopover>

	<Separator.Root class="mx-1 my-1 w-[1px] self-stretch bg-orange-200" />

	<!-- supper script and subscript group-->

	{@render toolBarButton({
		onclick: () => editor.chain().focus().toggleSubscript().run(),
		isActive: editor.isActive('subscript'),
		disabled: !editor.can().chain().focus().toggleSubscript().run(),
		Icon: Subscript
	})}

	{@render toolBarButton({
		onclick: () => editor.chain().focus().toggleSuperscript().run(),
		isActive: editor.isActive('superscript'),
		disabled: !editor.can().chain().focus().toggleSuperscript().run(),
		Icon: Superscript
	})}

	<Separator.Root class="mx-1 my-1 w-[1px] self-stretch bg-orange-200" />

	<!-- Alignment Group -->
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

	<Separator.Root class="mx-1 my-1 w-[1px] self-stretch bg-orange-200" />

	<!-- Add image -->

	{@render toolBarButton({
		onclick: async () => await addImage(),
		Icon: Image
	})}

	<!-- Add table -->
	<TablePopover {editor}>
		{@render toolBarButton({
			onclick: () => editor.commands.insertTable(),
			isActive: editor.isActive('table'),
			Icon: Table
		})}
	</TablePopover>

	<!-- Right Side Controls -->
	<!-- <div class="flex items-center gap-1">
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
	</div> -->
</div>
