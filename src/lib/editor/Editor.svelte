<script lang="ts">
	import { onMount } from 'svelte';

	import { join as pathJoin } from '@tauri-apps/api/path';
	import { readTextFile, exists, writeTextFile } from '@tauri-apps/plugin-fs';
	import { fileSystemStore } from '$lib/stores/fileSystem';
	import { invoke } from '@tauri-apps/api/core';

	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';

	import type { TiptapEditorHTMLElement } from '@tiptap/core';

	import TabsPanel from './TabsPanel.svelte';

	let element: TiptapEditorHTMLElement;
	let editor: Editor;
	let editable = true;
	let currentDir = '';

	onMount(async () => {
		currentDir = $fileSystemStore.currentPath;

		editor = new Editor({
			element: element,
			autofocus: 'end',
			extensions: [StarterKit],
			content: await getDocumentData(),
			onTransaction: () => {
				// force re-render so `editor.isActive` works as expected
				editor = editor;
			},
			onUpdate: async ({ editor }) => {
				const html = `
            <html>
                <head>

                </head>
                <body>
                <div class="tiptap">
                    ${editor.getHTML().replaceAll(/<p><\/p>/g, '<p><br></p>')}
                </div>
                    </body>
            </html>
        `;
				const pathToSave = await pathJoin(currentDir, 'magnum_opus.html');

				await writeTextFile(pathToSave, html);
			}
		});
	});

	function toggleView() {
		editable = !editable;
		editor.setEditable(editable);
	}

	async function exportToPdf() {
		try {
			await invoke('print_pdf_file', {
				currentDir
			});
		} catch (error) {
			console.error('Failed to export PDF:', error);
		}
	}

	async function getDocumentData() {
		const MagnumOpusPath = await pathJoin(currentDir, 'magnum_opus.html');
		const fileExists = await exists(MagnumOpusPath);
		if (!fileExists) {
			return {};
		}

		const fileData = await readTextFile(MagnumOpusPath);
		return fileData;
	}
</script>

<div class="editor-wrapper">
	{#if editor}
		<div class="control-group">
			<div class="button-group">
				<TabsPanel on:switch={toggleView} on:export={exportToPdf} />

				<button
					on:click={() => editor.chain().focus().toggleBold().run()}
					disabled={!editor.can().chain().focus().toggleBold().run()}
					class={editor.isActive('bold') ? 'is-active' : ''}
				>
					Bold
				</button>
				<button
					on:click={() => editor.chain().focus().toggleItalic().run()}
					disabled={!editor.can().chain().focus().toggleItalic().run()}
					class={editor.isActive('italic') ? 'is-active' : ''}
				>
					Italic
				</button>
				<button
					on:click={() => editor.chain().focus().toggleStrike().run()}
					disabled={!editor.can().chain().focus().toggleStrike().run()}
					class={editor.isActive('strike') ? 'is-active' : ''}
				>
					Strike
				</button>

				<button on:click={() => editor.chain().focus().unsetAllMarks().run()}>Clear marks</button>
				<button on:click={() => editor.chain().focus().clearNodes().run()}>Clear nodes</button>
				<button
					on:click={() => editor.chain().focus().setParagraph().run()}
					class={editor.isActive('paragraph') ? 'is-active' : ''}
				>
					Paragraph
				</button>
				<button
					on:click={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
					class={editor.isActive('heading', { level: 1 }) ? 'is-active' : ''}
				>
					H1
				</button>
				<button
					on:click={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
					class={editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}
				>
					H2
				</button>
				<button
					on:click={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
					class={editor.isActive('heading', { level: 3 }) ? 'is-active' : ''}
				>
					H3
				</button>
				<button
					on:click={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
					class={editor.isActive('heading', { level: 4 }) ? 'is-active' : ''}
				>
					H4
				</button>
				<button
					on:click={() => editor.chain().focus().toggleHeading({ level: 5 }).run()}
					class={editor.isActive('heading', { level: 5 }) ? 'is-active' : ''}
				>
					H5
				</button>
				<button
					on:click={() => editor.chain().focus().toggleHeading({ level: 6 }).run()}
					class={editor.isActive('heading', { level: 6 }) ? 'is-active' : ''}
				>
					H6
				</button>
				<button
					on:click={() => editor.chain().focus().toggleBulletList().run()}
					class={editor.isActive('bulletList') ? 'is-active' : ''}
				>
					Bullet list
				</button>
				<button
					on:click={() => editor.chain().focus().toggleOrderedList().run()}
					class={editor.isActive('orderedList') ? 'is-active' : ''}
				>
					Ordered list
				</button>
				<button
					on:click={() => editor.chain().focus().toggleCodeBlock().run()}
					class={editor.isActive('codeBlock') ? 'is-active' : ''}
				>
					Code block
				</button>
				<button
					on:click={() => editor.chain().focus().toggleBlockquote().run()}
					class={editor.isActive('blockquote') ? 'is-active' : ''}
				>
					Blockquote
				</button>
				<button on:click={() => editor.chain().focus().setHorizontalRule().run()}>
					Horizontal rule
				</button>
				<button on:click={() => editor.chain().focus().setHardBreak().run()}>Hard break</button>
				<button
					on:click={() => editor.chain().focus().undo().run()}
					disabled={!editor.can().chain().focus().undo().run()}
				>
					Undo
				</button>
				<button
					on:click={() => editor.chain().focus().redo().run()}
					disabled={!editor.can().chain().focus().redo().run()}
				>
					Redo
				</button>
			</div>
		</div>
	{/if}

	<div bind:this={element} />
</div>

<style>
	.button-group {
		border: 1px gray solid;
		& > button {
			padding: 5px;

			&.is-active {
				background-color: theme('colors.orange.300');
			}
		}
	}
</style>
