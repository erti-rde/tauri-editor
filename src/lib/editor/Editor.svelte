<script lang="ts">
	import { onMount } from 'svelte';

	import { citationStore } from '$lib/stores/citationStore';
	import { fileSystemStore, fileSystemState } from '$lib/stores/fileSystem.svelte';
	import { join as pathJoin } from '@tauri-apps/api/path';
	import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

	import { invoke } from '@tauri-apps/api/core';

	import TextAlign from '@tiptap/extension-text-align';
	import StarterKit from '@tiptap/starter-kit';
	import Underline from '@tiptap/extension-underline';
	import Highlight from '@tiptap/extension-highlight';
	import Link from '@tiptap/extension-link';
	import Subscript from '@tiptap/extension-subscript';
	import Superscript from '@tiptap/extension-superscript';
	import Image from '@tiptap/extension-image';
	import Table from '@tiptap/extension-table';
	import TableCell from '@tiptap/extension-table-cell';
	import TableHeader from '@tiptap/extension-table-header';
	import TableRow from '@tiptap/extension-table-row';

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

	let saveTimeout: ReturnType<typeof setTimeout> | undefined;
	let isSaving = false;

	onMount(async () => {
		await citationStore.initializeCitationStore();
		currentDir = $fileSystemStore.currentPath;

		editor = createEditor({
			editorProps: {
				attributes: {
					style: 'padding-left: 56px; padding-right: 56px',
					class:
						'focus:outline-none bg-white border border-[#C7C7C7] flex flex-col w-[816px] pt-10 pr-14 pb-10 cursor-text'
				}
			},
			autofocus: 'end',
			extensions: [
				StarterKit,
				TextAlign.configure({
					types: ['heading', 'paragraph']
				}),
				Subscript,
				Superscript,
				Underline,
				Highlight,
				Link.configure({
					HTMLAttributes: {
						class: 'tiptap-link'
					},
					openOnClick: false,
					defaultProtocol: 'https'
				}),
				Image,
				Table.configure({
					resizable: true
				}),
				TableRow,
				TableHeader,
				TableCell,
				Citation
			],
			content: await getDocumentData(),

			onUpdate: async ({ editor }) => {
				clearTimeout(saveTimeout);
				if (isSaving) {
					return;
				}
				saveTimeout = setTimeout(async () => {
					isSaving = true;
					try {
						const jsonContent = editor.getJSON();

						const pathToSaveJson = await pathJoin(currentDir, 'magnum_opus.json');

						// Save JSON first (it's smaller and less likely to cause issues)
						await writeTextFile(pathToSaveJson, JSON.stringify(jsonContent));
					} catch (error) {
						console.error('Save failed:', error);
					} finally {
						isSaving = false;
					}
				}, 500);
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

	async function getDocumentData() {
		const MagnumOpusPath = await pathJoin(currentDir, `magnum_opus.json`);
		const fileExists = await exists(MagnumOpusPath);
		if (!fileExists) {
			return {};
		}

		const fileData = await readTextFile(MagnumOpusPath);
		console.log('Loading content:', fileData); // Debug log

		if (!fileData.trim() || fileData === 'undefined') {
			console.warn('JSON file is empty or corrupted');
			return {};
		}

		try {
			const parsedData = JSON.parse(fileData);
			return parsedData;
		} catch (parseError) {
			console.error('JSON parse error:', parseError);
			console.error('Problematic content:', JSON.stringify(fileData));
			return { type: 'doc', content: [] };
		}
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
	<div class="flex h-full w-full flex-col bg-[#FAFBFD]">
		<div class="z-10 mb-1 shrink-0">
			<ToolBar editor={$editor} {toggleView} {exportToPdf} />
		</div>

		<div class="flex min-h-0 grow justify-center overflow-auto bg-[#f9fbfd] px-4">
			<EditorContent editor={$editor} />
			<BubbleMenu editor={$editor} requestCitation={handleCitationRequest} />

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
