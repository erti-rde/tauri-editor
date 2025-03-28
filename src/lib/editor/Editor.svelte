<script lang="ts">
	import { onMount } from 'svelte';

	import { citationStore } from '$lib/stores/citationStore';
	import { fileSystemStore } from '$lib/stores/fileSystem';
	import { currentFileStore } from '$lib/stores/openFileStore';
	import { join as pathJoin } from '@tauri-apps/api/path';
	import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

	import { invoke } from '@tauri-apps/api/core';

	import TextAlign from '@tiptap/extension-text-align';
	import StarterKit from '@tiptap/starter-kit';

	import createEditor from './core/CreateEditor';
	import { Editor } from './core/Editor';
	import EditorContent from './core/EditorContent.svelte';

	import type { Readable } from 'svelte/store';
	import BubbleMenu from './extensions/BubbleMenu.svelte';
	import { Citation } from './extensions/citation/Citation';
	import Result from './extensions/citation/Result.svelte';
	import ToolBar from './extensions/ToolBar.svelte';

	let editor = $state() as Readable<Editor>;
	let editable = true;
	let currentDir = '';

	onMount(async () => {
		await citationStore.initializeCitationStore();
		const readerExtension = $currentFileStore?.endsWith('.json') ? 'json' : 'html';
		const headNode = document.createElement('head');
		currentDir = $fileSystemStore.currentPath;

		editor = createEditor({
			editorProps: {
				attributes: {
					style: 'padding-left: 56px; padding-right: 56px',
					class:
						'focus:outline-none bg-white border border-[#C7C7C7] flex flex-col min-h-[1054px] w-[816px] pt-10 pr-14 pb-10 cursor-text'
				}
			},
			autofocus: 'end',
			extensions: [
				StarterKit,
				TextAlign.configure({
					types: ['heading', 'paragraph']
				}),
				Citation
			],
			content: await getDocumentData(readerExtension),
			onUpdate: async ({ editor }) => {
				const content = editor.getHTML();

				console.log('Saving content:', content); // Debug log

				const html = `
			       <html>
			           ${headNode.innerHTML}
			           <body>
			           <div>
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

		window.addEventListener('settings-updated', async (event: CustomEvent) => {
			const { localeHasChanged, styleHasChanged } = event.detail;

			if (localeHasChanged || styleHasChanged) {
				await citationStore.initializeCitationStore();
				$editor.commands.updateAllCitation();
			}
		});
	});

	function toggleView() {
		editable = !editable;
		$editor.setEditable(editable);
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

		return ext == 'json' ? JSON.parse(fileData) : fileData;
	}

	// Citation handling
	let selectedText = $state('');
	let showCitationPanel = $state(false);

	function handleCitationRequest() {
		selectedText = $editor.state.selection.empty
			? ''
			: $editor.state.doc.textBetween($editor.state.selection.from, $editor.state.selection.to);

		showCitationPanel = true;
	}

	function handleCitationSelect(citation: { id: string; inlineCitation: string }) {
		$editor.commands.insertCitation({
			id: citation.id,
			label: citation.inlineCitation
		});
		handlePanelClose();
	}

	function handlePanelClose() {
		showCitationPanel = false;
		selectedText = '';
	}
</script>

{#if $editor}
	<div class="min-h-screen bg-[#FAFBFD]">
		<div class="sticky top-0 z-50 transition-shadow duration-200">
			<ToolBar editor={$editor} {toggleView} {exportToPdf} />
		</div>
		<div class="flex size-full justify-center overflow-x-auto bg-[#f9fbfd] px-4">
			<div class="flex w-[816px] min-w-max justify-center py-4">
				<EditorContent editor={$editor} />
				<BubbleMenu editor={$editor} requestCitation={handleCitationRequest} />
			</div>
			{#if showCitationPanel}
				<Result
					{selectedText}
					selectCitation={handleCitationSelect}
					closePanel={handlePanelClose}
				/>
			{/if}
		</div>
	</div>
{/if}
