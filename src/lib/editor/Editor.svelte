<script lang="ts">
	import { onMount } from 'svelte';

	import { join as pathJoin } from '@tauri-apps/api/path';
	import { readTextFile, exists, writeTextFile } from '@tauri-apps/plugin-fs';
	import { fileSystemStore } from '$lib/stores/fileSystem';
  import { currentFileStore } from '$lib/stores/openFileStore';
	import { invoke } from '@tauri-apps/api/core';

	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import TextAlign from '@tiptap/extension-text-align';
	import type { TiptapEditorHTMLElement } from '@tiptap/core';

	import ToolBar from './ToolBar.svelte';
	import BubbleMenu from './BubbleMenu.svelte';

	let element: TiptapEditorHTMLElement;
	let styles: HTMLElement;
	let editor: Editor;
	let editable = true;
	let currentDir = '';

	onMount(async () => {
    const readerExtension = $currentFileStore?.endsWith(".json") ? 'json' : 'html'
		const headNode = document.createElement('head');
		const stylesNode = document.createElement('style');
		stylesNode.innerHTML = styles.innerHTML;
		headNode.appendChild(stylesNode);
		currentDir = $fileSystemStore.currentPath;

		editor = new Editor({
			editorProps: {
				attributes: {
					style: 'padding-left: 56px; padding-right: 56px',
					class:
						'focus:outline-none bg-white border border-[#C7C7C7] flex flex-col min-h-[1054px] w-[816px] pt-10 pr-14 pb-10 cursor-text'
				}
			},
			injectCSS: false,
			element: element,
			autofocus: 'end',
			extensions: [
				StarterKit,
				TextAlign.configure({
					types: ['heading', 'paragraph']
				})
			],
			content: await getDocumentData(readerExtension),
			onTransaction: () => {
				// force re-render so `editor.isActive` works as expected
				editor = editor;
			},
			onUpdate: async ({ editor }) => {
				const content = editor.getHTML();

				console.log('Saving content:', content); // Debug log

				const html = `
            <html>
                ${headNode.innerHTML}
                <body>
                <div class="tiptap bg-orange-400">
                    ${content.replaceAll(/<p><\/p>/g, '<p><br></p>')}
                </div>
                    </body>
            </html>
        `;
				const pathToSave = await pathJoin(currentDir, 'magnum_opus.html');
        const pathToSaveJson = await pathJoin(currentDir, 'magnum_opus.json');
				await writeTextFile(pathToSave, html);
        await writeTextFile(pathToSaveJson, JSON.stringify(editor.getJSON()));
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

	async function getDocumentData(ext: string) {
		const MagnumOpusPath = await pathJoin(currentDir, `magnum_opus.${ext}`);
		console.log(`🚀 ~ MagnumOpusPath:`, MagnumOpusPath);
		const fileExists = await exists(MagnumOpusPath);
		console.log(`🚀 ~ fileExists:`, fileExists);
		if (!fileExists) {
			return {};
		}

		const fileData = await readTextFile(MagnumOpusPath);
		console.log('Loading content:', fileData); // Debug log

		return ext == "json" ? JSON.parse(fileData) : fileData;
	}
</script>

<div class="min-h-screen bg-[#FAFBFD]">
	<style bind:this={styles}>
		/* Basic editor styles */
		.tiptap {
			font-family: Arial, sans-serif;

			& :first-child {
				margin-top: 0;
			}
			/* Heading styles */
			h1,
			h2,
			h3,
			h4,
			h5,
			h6 {
				line-height: 1.1;
				margin-top: 2.5rem;
				text-wrap: pretty;
			}

			h1,
			h2 {
				margin-top: 3.5rem;
				margin-bottom: 1.5rem;
			}

			h1 {
				font-size: 1.4rem;
			}

			h2 {
				font-size: 1.2rem;
			}

			h3 {
				font-size: 1.1rem;
			}

			h4,
			h5,
			h6 {
				font-size: 1rem;
			}

			/* List styles */
			ul,
			ol {
				list-style: reset;
				padding: 0 1rem;
				margin: 1.25rem 1rem 1.25rem 0.4rem;

				li p {
					margin-top: 0.25em;
					margin-bottom: 0.25em;
				}
			}

			ul li {
				list-style-type: disc;
			}

			ol li {
				list-style-type: decimal;
			}

			footnote {
				counter-increment: footnote-counter;
				cursor: pointer;
				position: relative;
			}

			footnote::after {
				content: '[' counter(footnote-counter) ']';
				vertical-align: super;
				font-size: 0.8em;
				color: blue;
			}

			.footnote-tooltip {
				position: absolute;
				background: white;
				padding: 5px;
				border: 1px solid #ddd;
				border-radius: 4px;
				box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
				z-index: 20;
				min-width: 300px;
				margin-top: 8px;
			}

			footnote.ProseMirror-selectednode {
				outline: 2px solid blue;
			}
		}
	</style>
	{#if editor}
		<div class="sticky top-0 z-50 transition-shadow duration-200">
			<ToolBar {editor} on:switch={toggleView} on:export={exportToPdf} />
		</div>
		<BubbleMenu {editor} />
	{/if}
	<div class="flex size-full justify-center overflow-x-auto bg-[#f9fbfd] px-4">
		<div class="flex w-[816px] min-w-max justify-center py-4">
			<div bind:this={element} />
		</div>
	</div>
</div>
