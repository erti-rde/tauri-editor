<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import EditorJs from '@editorjs/editorjs';
	import Header from '@editorjs/header';
	import List from '@editorjs/list';
	import Undo from 'editorjs-undo';

	import Result from './Result.svelte';

	import { InlineCitation } from './Citation';
	import { Bibliography } from './Bibliography';

	import { appLocalDataDir, join as pathJoin } from '@tauri-apps/api/path';
	import { readTextFile, exists, writeFile } from '@tauri-apps/api/fs';

	let editor: EditorJs;
	let openResultPanel = false;
	let selectedText = '';

	onMount(async () => {
		editor = new EditorJs({
			holder: 'editorjs',
			autofocus: true,
			tools: {
				InlineCitation,
				bibliography: Bibliography,
				header: {
					class: Header,
					config: {
						placeholder: 'Magnum Opus Title'
					}
				},
				list: {
					class: List
				}
			},

			data: await getDocumentData(),
			onReady: () => {
				new Undo({ editor });
			}
		});
		window.addEventListener('citation', selectTextForCitation);
	});

	onDestroy(() => {
		window.removeEventListener('citation', selectTextForCitation);
	});

	async function getDocumentData() {
		const sourcesLocation = await appLocalDataDir();
		const MagnumOpusPath = await pathJoin(sourcesLocation, 'magnum_opus.json');
		const fileExists = await exists(MagnumOpusPath);
		if (!fileExists) {
			return {};
		}

		const fileData = await readTextFile(MagnumOpusPath);
		return JSON.parse(fileData);
	}

	async function saveDocument() {
		const outputData = await editor.save();
		const sourcesLocation = await appLocalDataDir();
		const MagnumOpusPath = await pathJoin(sourcesLocation, 'magnum_opus.json');
		await writeFile(MagnumOpusPath, JSON.stringify(outputData));
	}

	async function handleSelect(event: CustomEvent) {
		const { citation, selectedText } = event.detail;
		const { inlineCitation, fullCitation } = citation;
		const currentBlockIndex = editor.blocks.getCurrentBlockIndex();
		const block = editor.blocks.getBlockByIndex(currentBlockIndex);
		const htmlHolder = block?.holder;
		const contentEl = htmlHolder?.querySelector('[data-placeholder]') as HTMLElement;
		const content = contentEl?.textContent;
		const splitContent = content?.split(selectedText);
		const newContent =
			splitContent &&
			splitContent[0] + `${selectedText}` + ` (${inlineCitation}) ` + `${splitContent[1]}`;

		contentEl.textContent = newContent || content;
		const biblioGraphyId = 'magnus-opus-id';
		const bibliography = editor.blocks.getById(biblioGraphyId);
		const numberOfBlocks = editor.blocks.getBlocksCount();
		const biblioGraphyBlock = numberOfBlocks;
		if (bibliography) {
			await editor.blocks.insert(
				'paragraph',
				{
					text: fullCitation
				},
				{},
				biblioGraphyBlock,
				undefined,
				undefined,
				biblioGraphyId
			);
		} else {
			await editor.blocks.insert(
				'header',
				{
					text: 'Bibliography',
					level: 2
				},
				{},
				biblioGraphyBlock,
				undefined,
				undefined,
				biblioGraphyId
			);
		}

		await saveDocument();
	}

	function selectTextForCitation(event: Event) {
		const { startOffset, endOffset, commonAncestorContainer } = event.detail.range;
		selectedText = commonAncestorContainer?.data.slice(startOffset, endOffset);
		openResultPanel = true;
	}

	setInterval(() => {
		saveDocument();
	}, 5000);
</script>

<div>
	<div id="editorjs"></div>
	{#if openResultPanel}
		<Result
			{selectedText}
			on:select={handleSelect}
			on:close-panel={() => (openResultPanel = false)}
		/>
	{/if}
</div>

<style>
	div {
		position: relative;
		height: 100%;
		width: 100%;
	}
</style>
