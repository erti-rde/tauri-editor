<script lang="ts">
	import type { SvelteComponent } from 'svelte';
	import type { SvelteHTMLElements } from 'svelte/elements';
	import { type Editor } from '@tiptap/core';

	import { open } from '@tauri-apps/plugin-dialog';
	import { convertFileSrc } from '@tauri-apps/api/core';

	import { Separator } from 'bits-ui';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	// Import Icons for toolbar
	import Bold from '~icons/lucide/bold';
	import BookText from '~icons/lucide/book-text';
	import BookOpen from '~icons/lucide/book-open';
	import FilePen from '~icons/lucide/file-pen';
	import FileOutput from '~icons/lucide/file-output';
	import SeparatorHorizontal from '~icons/lucide/separator-horizontal';
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
	import ZoomControl from '../pagination/ZoomControl.svelte';

	interface Props {
		editor: Editor;
		toggleView: () => void;
		exportToPdf: () => void;
		exportToLatex: () => void;
	}

	// toggleView and exportToPdf are used in the markup below, but
	// @typescript-eslint/no-unused-vars does not track Svelte template references.
	let { editor, toggleView, exportToPdf, exportToLatex }: Props = $props();

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
	Icon,
	label,
	shortcut
}: {
	onclick: () => void;
	disabled?: boolean;
	isActive?: boolean;
	Icon: typeof SvelteComponent<SvelteHTMLElements['svg']>;
	/** What the button does. Also its accessible name. */
	label: string;
	shortcut?: string;
})}
	<Tooltip {label} {shortcut}>
		{#snippet children(tooltip)}
			<button
				{...tooltip}
				class={[
					'hover:bg-surface-hover focus-visible:ring-accent rounded p-1.5 transition-colors duration-150 ease-in-out focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
					isActive && 'bg-accent-quiet text-accent'
				]}
				{onclick}
				{disabled}
				aria-pressed={isActive}
			>
				<Icon />
			</button>
		{/snippet}
	</Tooltip>
{/snippet}

<div
	class="bg-surface-raised/95 border-line flex h-(--toolbar-l) w-full items-center border-b px-2 py-1 shadow-md backdrop-blur-sm"
>
	<!-- Zoom sits at the left, apart from the formatting controls: it acts on the
	     view rather than on the selection, which is where every editor with one
	     puts it. -->
	<ZoomControl />

	<Separator.Root class="bg-line mx-1 my-1 w-px self-stretch" />

	<!-- The formatting controls stay centred on the window, as before, with the
	     view controls held to the edges either side of them. -->
	<div class="flex flex-1 justify-center">
		<!-- History Controls Group -->

		{@render toolBarButton({
			onclick: () => editor.chain().focus().undo().run(),
			disabled: !editor.can().undo(),
			Icon: Undo,
			label: 'Undo',
			shortcut: 'Mod Z'
		})}
		{@render toolBarButton({
			onclick: () => editor.chain().focus().redo().run(),
			disabled: !editor.can().redo(),
			Icon: Redo,
			label: 'Redo',
			shortcut: 'Mod Shift Z'
		})}

		<Separator.Root class="bg-line mx-1 my-1 w-px self-stretch" />

		{#snippet defaultHeadingButton()}
			<Heading class="ml-1" />
		{/snippet}

		{#snippet defaultListButtons()}
			<ListUnordered class="ml-1" />
		{/snippet}

		<Dropdown
			buttonText={defaultHeadingButton}
			ariaLabel="Text style"
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
			ariaLabel="List style"
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
			Icon: Blockquote,
			label: 'Block quote',
			shortcut: 'Mod Shift B'
		})}
		{@render toolBarButton({
			onclick: () => editor.chain().focus().toggleCodeBlock().run(),
			isActive: editor.isActive('codeBlock'),
			disabled: !editor.can().chain().focus().toggleCodeBlock().run(),
			Icon: CodeBlock,
			label: 'Code block',
			shortcut: 'Mod Alt C'
		})}

		<Separator.Root class="bg-line mx-1 my-1 w-px self-stretch" />

		<!-- Text Formatting Group -->
		{@render toolBarButton({
			onclick: () => editor.chain().focus().toggleBold().run(),
			isActive: editor.isActive('bold'),
			disabled: !editor.can().chain().focus().toggleBold().run(),
			Icon: Bold,
			label: 'Bold',
			shortcut: 'Mod B'
		})}
		{@render toolBarButton({
			onclick: () => editor.chain().focus().toggleItalic().run(),
			isActive: editor.isActive('italic'),
			disabled: !editor.can().chain().focus().toggleItalic().run(),
			Icon: Italic,
			label: 'Italic',
			shortcut: 'Mod I'
		})}
		{@render toolBarButton({
			onclick: () => editor.chain().focus().toggleStrike().run(),
			isActive: editor.isActive('strike'),
			disabled: !editor.can().chain().focus().toggleStrike().run(),
			Icon: StrikeThrough,
			label: 'Strikethrough',
			shortcut: 'Mod Shift X'
		})}
		{@render toolBarButton({
			onclick: () => editor.chain().focus().toggleUnderline().run(),
			isActive: editor.isActive('underline'),
			disabled: !editor.can().chain().focus().toggleUnderline().run(),
			Icon: Underline,
			label: 'Underline',
			shortcut: 'Mod U'
		})}
		{@render toolBarButton({
			onclick: () => editor.chain().focus().toggleCode().run(),
			isActive: editor.isActive('code'),
			disabled: !editor.can().chain().focus().toggleCode().run(),
			Icon: InlineCode,
			label: 'Inline code',
			shortcut: 'Mod E'
		})}
		{@render toolBarButton({
			onclick: () => editor.chain().focus().toggleHighlight().run(),
			isActive: editor.isActive('highlight'),
			disabled: !editor.can().chain().focus().toggleHighlight().run(),
			Icon: Highlighter,
			label: 'Highlight'
		})}

		<!-- Configure Link -->

		<LinkPopover {editor} isActive={editor.isActive('link')}>
			{@render toolBarButton({
				onclick: () => null,
				Icon: Link,
				label: 'Link',
				shortcut: 'Mod K'
			})}
		</LinkPopover>

		<Separator.Root class="bg-line mx-1 my-1 w-px self-stretch" />

		<!-- supper script and subscript group-->

		{@render toolBarButton({
			onclick: () => editor.chain().focus().toggleSubscript().run(),
			isActive: editor.isActive('subscript'),
			disabled: !editor.can().chain().focus().toggleSubscript().run(),
			Icon: Subscript,
			label: 'Subscript',
			shortcut: 'Mod ,'
		})}

		{@render toolBarButton({
			onclick: () => editor.chain().focus().toggleSuperscript().run(),
			isActive: editor.isActive('superscript'),
			disabled: !editor.can().chain().focus().toggleSuperscript().run(),
			Icon: Superscript,
			label: 'Superscript',
			shortcut: 'Mod .'
		})}

		<!-- A break the author places. Print rules decide where a page *may* break;
	     only this says where one *must* end — a chapter, or the references. -->
		{@render toolBarButton({
			onclick: () => editor.chain().focus().insertPageBreak().run(),
			isActive: editor.isActive('pageBreak'),
			Icon: SeparatorHorizontal,
			label: 'Insert a page break',
			shortcut: 'Mod Enter'
		})}

		<!-- The works cited. A document node, so it exports and paginates with the
	     manuscript rather than living beside it. -->
		{@render toolBarButton({
			onclick: () => editor.chain().focus().insertBibliography().run(),
			isActive: editor.isActive('bibliography'),
			Icon: BookText,
			label: 'Add the references section'
		})}

		<Separator.Root class="bg-line mx-1 my-1 w-px self-stretch" />

		<!-- Alignment Group -->
		{@render toolBarButton({
			onclick: () => editor.chain().focus().setTextAlign('left').run(),
			isActive: editor.isActive({ textAlign: 'left' }),
			Icon: AlignLeft,
			label: 'Align left'
		})}
		{@render toolBarButton({
			onclick: () => editor.chain().focus().setTextAlign('center').run(),
			isActive: editor.isActive({ textAlign: 'center' }),
			Icon: AlignCenter,
			label: 'Align centre'
		})}
		{@render toolBarButton({
			onclick: () => editor.chain().focus().setTextAlign('right').run(),
			isActive: editor.isActive({ textAlign: 'right' }),
			Icon: AlignRight,
			label: 'Align right'
		})}
		{@render toolBarButton({
			onclick: () => editor.chain().focus().setTextAlign('justify').run(),
			isActive: editor.isActive({ textAlign: 'justify' }),
			Icon: AlignJustify,
			label: 'Justify'
		})}

		<Separator.Root class="bg-line mx-1 my-1 w-px self-stretch" />

		<!-- Add image -->

		{@render toolBarButton({
			onclick: async () => await addImage(),
			Icon: Image,
			label: 'Insert an image'
		})}

		<!-- Add table -->
		<TablePopover {editor}>
			{@render toolBarButton({
				onclick: () => editor.commands.insertTable(),
				isActive: editor.isActive('table'),
				Icon: Table,
				label: 'Insert a table'
			})}
		</TablePopover>
	</div>

	<!--
		Export and the read/write toggle, held at the right edge so the writing
		controls stay centred between them and zoom. This group was commented out
		once, which is why export had no way in despite working.
	-->
	<div class="flex shrink-0 items-center gap-1">
		{@render toolBarButton({
			onclick: toggleView,
			Icon: editor.isEditable ? BookOpen : FilePen,
			label: editor.isEditable ? 'Preview without editing' : 'Back to editing'
		})}

		<Separator.Root class="bg-line mx-1 my-1 w-px self-stretch" />

		{@render toolBarButton({
			onclick: exportToPdf,
			Icon: FileOutput,
			label: 'Export as PDF'
		})}

		<Tooltip label="Export a LaTeX bundle" shortcut="main.tex + references.bib">
			{#snippet children(tooltip)}
				<button
					{...tooltip}
					class="hover:bg-surface-hover focus-visible:ring-accent text-ink-muted hover:text-ink rounded px-1.5 py-1.5 font-mono text-[11px] transition-colors focus-visible:ring-2"
					onclick={exportToLatex}
				>
					.tex
				</button>
			{/snippet}
		</Tooltip>
	</div>
</div>
