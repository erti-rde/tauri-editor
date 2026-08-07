<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	import { citationStore } from '$lib/stores/citationStore';
	import { errorToast } from '$lib/toast/Toast.svelte';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { fileSystemStore } from '$lib/stores/fileSystem.svelte';
	import { join as pathJoin } from '@tauri-apps/api/path';
	import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

	import { invoke } from '@tauri-apps/api/core';

	import { createAutosave, type SaveState } from './autosave';
	import createEditor from './core/CreateEditor';
	import { Editor } from './core/Editor';
	import EditorContent from './core/EditorContent.svelte';
	import { editorExtensions } from './core/extensions';

	import type { Readable } from 'svelte/store';
	import BubbleMenu from './extensions/BubbleMenu.svelte';
	import Result from './extensions/citation/Result.svelte';
	import ToolBar from './extensions/ToolBar.svelte';

	/**
	 * The manuscript's filename.
	 *
	 * Still one hardcoded name per project — multi-document support (#57) is what
	 * removes that. Named once here so the reader and the writer cannot disagree,
	 * which they could when the string was repeated.
	 */
	const DOCUMENT_FILE = 'magnum_opus.json';

	let editor = $state() as Readable<Editor>;
	let editable = true;
	let currentDir = '';

	/**
	 * Autosave, which has to keep every keystroke.
	 *
	 * The previous version cancelled the pending save on each update and then
	 * returned without scheduling anything if a write was in flight, so edits
	 * made during a write were dropped — permanently, if the user stopped typing
	 * there. The logic now lives in ./autosave with tests for that race.
	 */
	let saveState = $state<SaveState>('idle');
	let unlistenClose: (() => void) | undefined;

	const autosave = createAutosave({
		write: async (content) => {
			const path = await pathJoin(currentDir, DOCUMENT_FILE);
			await writeTextFile(path, JSON.stringify(content));
		},
		onStateChange: (next) => (saveState = next),
		onError: (error) => {
			// A failed save is the one thing the user must not miss. The content is
			// kept and retried on a backoff, so this says that rather than implying
			// the work is gone.
			console.error('Save failed:', error);
			errorToast(
				`Could not save your document: ${error instanceof Error ? error.message : String(error)}. Your changes are kept and will be saved again automatically.`
			);
		}
	});

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
			extensions: editorExtensions,
			content: await getDocumentData(),

			onUpdate: ({ editor }) => {
				// The getter is passed rather than the content: it is read when the
				// save actually runs, so a burst of typing costs one write and always
				// writes the newest document.
				autosave.schedule(() => editor.getJSON());
			}
		});

		// Closing the window is the last chance to write, and `beforeunload` cannot
		// take it: the browser does not await a promise, so the webview can go away
		// mid-write and lose the work. Tauri's close request can be held open,
		// which turns best-effort into an actual guarantee.
		unlistenClose = await getCurrentWindow().onCloseRequested(async (event) => {
			if (!autosave.hasUnsavedChanges) return;

			event.preventDefault();
			const saved = await autosave.flush();

			if (!saved) {
				// The disk refused. Closing now would discard the work silently, so
				// the window stays open with the failure on screen.
				errorToast('Could not save your document, so the window was kept open. Try again.');
				return;
			}

			await getCurrentWindow().destroy();
		});

		window.addEventListener('settings-updated', async (event: CustomEvent) => {
			const { localeHasChanged, styleHasChanged } = event.detail;

			if (localeHasChanged || styleHasChanged) {
				await citationStore.initializeCitationStore();
				$editor.commands.updateAllCitation();
			}
		});
	});

	onDestroy(() => {
		// Best-effort: a component teardown cannot be awaited. The close handler
		// above is what actually guarantees the write; this covers switching away
		// from a document while the app stays open.
		void autosave.flush();
		unlistenClose?.();
		autosave.destroy();
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
		const MagnumOpusPath = await pathJoin(currentDir, DOCUMENT_FILE);
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

			<!--
				Whether the work is safe. A failed save keeps the content and retries,
				so the message says that rather than implying the work is gone — and
				it stays put instead of disappearing like a toast, because it is the
				one thing the user must not miss.
			-->
			<div class="flex justify-end px-4 pb-1 text-xs" aria-live="polite">
				{#if saveState === 'error'}
					<span class="font-medium text-red-600">Not saved — retrying, your work is kept</span>
				{:else if saveState === 'saving'}
					<span class="text-gray-500">Saving…</span>
				{:else if saveState === 'pending'}
					<span class="text-gray-400">Unsaved changes</span>
				{:else}
					<span class="text-gray-400">Saved</span>
				{/if}
			</div>
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
