<script lang="ts">
	import { type Editor } from '@tiptap/core';

	import { open } from '@tauri-apps/plugin-dialog';
	import { convertFileSrc } from '@tauri-apps/api/core';

	// Import Icons for toolbar
	import Bold from '~icons/lucide/bold';
	import BookText from '~icons/lucide/book-text';
	import BookOpen from '~icons/lucide/book-open';
	import FilePen from '~icons/lucide/file-pen';
	import FileCode from '~icons/lucide/file-code';
	import FileText from '~icons/lucide/file-text';
	import FileType from '~icons/lucide/file-type';
	import ScanText from '~icons/lucide/scan-text';
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

	import {
		IconButton,
		Menu,
		ToggleButton,
		Toolbar,
		ToolbarGroup,
		type IconComponent,
		type MenuItem
	} from '$lib/ui';
	import { attributionCheck } from '$lib/attribution/check.svelte';
	import type { Exports } from '$lib/export/exports';
	import LinkPopover from './LinkPopover.svelte';
	import TablePopover from './TablePopover.svelte';
	import ZoomControl from '../pagination/ZoomControl.svelte';

	interface Props {
		editor: Editor;
		toggleView: () => void;
		exports: Exports;
	}

	// toggleView is used in the markup below, but
	// @typescript-eslint/no-unused-vars does not track Svelte template references.
	let { editor, toggleView, exports }: Props = $props();

	/**
	 * One Export menu (UX-8), with the attribution check first: the moment of
	 * sending a paper out is the moment to look again. The dot says the document
	 * has changed since the last check, and the line under it says so in words.
	 */
	const exportItems: MenuItem[] = $derived([
		{
			label: 'Check attribution first…',
			icon: ScanText,
			description: attributionCheck.stale ? 'Changed since the last check' : undefined,
			dot: attributionCheck.stale,
			onSelect: () => void attributionCheck.run()
		},
		{ label: 'PDF…', icon: FileText, separated: true, onSelect: () => void exports.pdf() },
		{ label: 'Word document (.docx)…', icon: FileType, onSelect: () => void exports.word() },
		{ label: 'LaTeX bundle…', icon: FileCode, onSelect: () => void exports.latex() }
	]);

	function handleFormatSelect(format: string) {
		if (format === 'paragraph') {
			editor.chain().focus().setParagraph().run();
		} else {
			const level = parseInt(format.slice(1)) as 1 | 2 | 3;
			editor.chain().focus().toggleHeading({ level }).run();
		}
	}

	// Read the same way the buttons below read `isActive`: again each time the
	// editor is handed in.
	const headings: MenuItem[] = $derived(
		[
			{ label: 'Heading 1', icon: Heading1, level: 1 as const },
			{ label: 'Heading 2', icon: Heading2, level: 2 as const },
			{ label: 'Heading 3', icon: Heading3, level: 3 as const }
		].map(({ label, icon, level }) => ({
			label,
			icon,
			active: editor.isActive('heading', { level }),
			onSelect: () => handleFormatSelect(`h${level}`)
		}))
	);

	const lists: MenuItem[] = $derived([
		{
			label: 'Bullet List',
			icon: ListUnordered,
			active: editor.isActive('bulletList'),
			onSelect: () => editor.chain().focus().toggleBulletList().run()
		},
		{
			label: 'Ordered List',
			icon: ListOrdered,
			active: editor.isActive('orderedList'),
			onSelect: () => editor.chain().focus().toggleOrderedList().run()
		}
	]);

	async function addImage() {
		const selectedFile = await open({
			multiple: false
		});
		if (selectedFile) {
			const imageUrl = typeof selectedFile === 'string' ? selectedFile : selectedFile[0];
			const convertedUrl = convertFileSrc(imageUrl);
			editor.chain().focus().setImage({ src: convertedUrl }).run();
		}
	}
</script>

{#snippet toggle(
	label: string,
	icon: IconComponent,
	mark: string,
	command: () => boolean,
	can: boolean,
	shortcut?: string
)}
	<ToggleButton
		{label}
		{icon}
		{shortcut}
		pressed={editor.isActive(mark)}
		disabled={!can}
		onclick={command}
	/>
{/snippet}

{#snippet align(label: string, icon: IconComponent, side: 'left' | 'center' | 'right' | 'justify')}
	<ToggleButton
		{label}
		{icon}
		pressed={editor.isActive({ textAlign: side })}
		onclick={() => editor.chain().focus().setTextAlign(side).run()}
	/>
{/snippet}

<!-- The trigger shows what the cursor is in, so the current style can be read
     without opening the menu. -->
{#snippet current(items: MenuItem[], Fallback: MenuItem['icon'])}
	{@const active = items.find((item) => item.active)}
	{@const Shown = active?.icon ?? Fallback}
	<Shown class={['size-4', active && 'text-accent']} aria-hidden="true" />
{/snippet}

<Toolbar
	label="Formatting"
	class="bg-surface-raised border-line h-(--toolbar-l) w-full border-b px-2"
>
	<!-- Zoom sits at the left, apart from the formatting controls: it acts on the
	     view rather than on the selection, which is where every editor with one
	     puts it. -->
	<ToolbarGroup label="Zoom">
		<ZoomControl />
	</ToolbarGroup>

	<!-- The formatting controls stay centred on the window, with the view
	     controls held to the edges either side of them. -->
	<span class="grow" aria-hidden="true"></span>

	<ToolbarGroup>
		<IconButton
			label="Undo"
			icon={Undo}
			shortcut="Mod Z"
			disabled={!editor.can().undo()}
			onclick={() => editor.chain().focus().undo().run()}
		/>
		<IconButton
			label="Redo"
			icon={Redo}
			shortcut="Mod Shift Z"
			disabled={!editor.can().redo()}
			onclick={() => editor.chain().focus().redo().run()}
		/>
	</ToolbarGroup>

	<ToolbarGroup>
		<Menu label="Text style" items={headings}>
			{#snippet trigger()}{@render current(headings, Heading)}{/snippet}
		</Menu>
		<Menu label="List style" items={lists}>
			{#snippet trigger()}{@render current(lists, ListUnordered)}{/snippet}
		</Menu>
		{@render toggle(
			'Block quote',
			Blockquote,
			'blockquote',
			() => editor.chain().focus().toggleBlockquote().run(),
			editor.can().chain().focus().toggleBlockquote().run(),
			'Mod Shift B'
		)}
		{@render toggle(
			'Code block',
			CodeBlock,
			'codeBlock',
			() => editor.chain().focus().toggleCodeBlock().run(),
			editor.can().chain().focus().toggleCodeBlock().run(),
			'Mod Alt C'
		)}
	</ToolbarGroup>

	<ToolbarGroup>
		{@render toggle(
			'Bold',
			Bold,
			'bold',
			() => editor.chain().focus().toggleBold().run(),
			editor.can().chain().focus().toggleBold().run(),
			'Mod B'
		)}
		{@render toggle(
			'Italic',
			Italic,
			'italic',
			() => editor.chain().focus().toggleItalic().run(),
			editor.can().chain().focus().toggleItalic().run(),
			'Mod I'
		)}
		{@render toggle(
			'Strikethrough',
			StrikeThrough,
			'strike',
			() => editor.chain().focus().toggleStrike().run(),
			editor.can().chain().focus().toggleStrike().run(),
			'Mod Shift X'
		)}
		{@render toggle(
			'Underline',
			Underline,
			'underline',
			() => editor.chain().focus().toggleUnderline().run(),
			editor.can().chain().focus().toggleUnderline().run(),
			'Mod U'
		)}
		{@render toggle(
			'Inline code',
			InlineCode,
			'code',
			() => editor.chain().focus().toggleCode().run(),
			editor.can().chain().focus().toggleCode().run(),
			'Mod E'
		)}
		{@render toggle(
			'Highlight',
			Highlighter,
			'highlight',
			() => editor.chain().focus().toggleHighlight().run(),
			editor.can().chain().focus().toggleHighlight().run()
		)}
		<LinkPopover {editor} isActive={editor.isActive('link')}>
			{#snippet children(trigger)}
				<IconButton {...trigger} label="Link" icon={Link} shortcut="Mod K" />
			{/snippet}
		</LinkPopover>
	</ToolbarGroup>

	<ToolbarGroup>
		{@render toggle(
			'Subscript',
			Subscript,
			'subscript',
			() => editor.chain().focus().toggleSubscript().run(),
			editor.can().chain().focus().toggleSubscript().run(),
			'Mod ,'
		)}
		{@render toggle(
			'Superscript',
			Superscript,
			'superscript',
			() => editor.chain().focus().toggleSuperscript().run(),
			editor.can().chain().focus().toggleSuperscript().run(),
			'Mod .'
		)}
		<!-- A break the author places. Print rules decide where a page *may* break;
		     only this says where one *must* end — a chapter, or the references. -->
		<IconButton
			label="Insert a page break"
			icon={SeparatorHorizontal}
			shortcut="Mod Enter"
			onclick={() => editor.chain().focus().insertPageBreak().run()}
		/>
		<!-- The works cited. A document node, so it exports and paginates with the
		     manuscript rather than living beside it. -->
		<IconButton
			label="Add the references section"
			icon={BookText}
			onclick={() => editor.chain().focus().insertBibliography().run()}
		/>
	</ToolbarGroup>

	<ToolbarGroup>
		{@render align('Align left', AlignLeft, 'left')}
		{@render align('Align centre', AlignCenter, 'center')}
		{@render align('Align right', AlignRight, 'right')}
		{@render align('Justify', AlignJustify, 'justify')}
	</ToolbarGroup>

	<ToolbarGroup>
		<IconButton label="Insert an image" icon={Image} onclick={addImage} />
		<TablePopover {editor}>
			{#snippet children(trigger)}
				<IconButton
					{...trigger}
					label="Insert a table"
					icon={Table}
					onclick={() => editor.commands.insertTable()}
				/>
			{/snippet}
		</TablePopover>
	</ToolbarGroup>

	<span class="grow" aria-hidden="true"></span>

	<!--
		Export and the read/write toggle, held at the right edge so the writing
		controls stay centred between them and zoom. This group was commented out
		once, which is why export had no way in despite working.
	-->
	<ToolbarGroup rule={false}>
		<IconButton
			label={editor.isEditable ? 'Preview without editing' : 'Back to editing'}
			icon={editor.isEditable ? BookOpen : FilePen}
			onclick={toggleView}
		/>
	</ToolbarGroup>
	<ToolbarGroup>
		<Menu label="Export" items={exportItems} align="end" />
	</ToolbarGroup>
</Toolbar>
