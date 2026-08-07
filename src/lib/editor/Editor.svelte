<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	import { citationStore } from '$lib/stores/citationStore';
	import { errorToast, successToast } from '$lib/toast/Toast.svelte';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { fileSystemStore } from '$lib/stores/fileSystem.svelte';
	import { join as pathJoin } from '@tauri-apps/api/path';
	import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
	import { invoke } from '@tauri-apps/api/core';

	import { get } from 'svelte/store';

	import { load as loadStore } from '@tauri-apps/plugin-store';

	import { createAutosave, type SaveState } from './autosave';
	import { countDocument, progressTo, type WordCount } from './wordCount';
	import { parseCitationIds } from '$lib/citations/document';
	import { toBibliography } from '$lib/export/bibtex';
	import { toLatexDocument } from '$lib/export/latex';
	import { DOCUMENT_EXTENSION, toDocumentFileName, type ProjectDocument } from './documents';
	import { documentsStore } from '$lib/stores/documents.svelte';
	import createEditor from './core/CreateEditor';
	import DocumentBar from './DocumentBar.svelte';
	import { Editor } from './core/Editor';
	import EditorContent from './core/EditorContent.svelte';
	import { editorExtensions } from './core/extensions';

	import type { Readable } from 'svelte/store';
	import BubbleMenu from './extensions/BubbleMenu.svelte';
	import Result from './extensions/citation/Result.svelte';
	import ToolBar from './extensions/ToolBar.svelte';

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
	/** Set when the open file could not be parsed, so autosave must not overwrite it. */
	let readFailed = $state(false);
	/** Bumped on each document switch, so a superseded one abandons itself. */
	let transition = 0;

	/**
	 * The number a researcher is actually writing to.
	 *
	 * Settings has persisted a target since before this work began and nothing
	 * ever read it, so the figure that decides whether a paper can be submitted
	 * was invisible.
	 */
	let words = $state<WordCount>({ body: 0, references: 0, total: 0, characters: 0 });
	let wordTarget = $state(0);

	const autosave = createAutosave({
		write: async (content) => {
			// Resolved at write time, not captured: switching documents changes
			// where the next save goes, and a stale path would write one
			// manuscript's text into another's file.
			const target = get(documentsStore).current;
			if (!target) return;

			await writeTextFile(target.path, JSON.stringify(content));
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

		// A project that has never been opened in this version has no manuscript
		// at all; one written before multiple documents existed has exactly one,
		// under the old fixed name. Both are handled by reading the folder.
		documentsStore.refresh();
		if (!$documentsStore.current) await createFirstDocument();

		wordTarget = Number((await (await loadStore('settings-store.json')).get('wordCount')) ?? 0);

		editor = createEditor({
			editorProps: {
				attributes: {
					style: 'padding-left: 56px; padding-right: 56px',
					class:
						'manuscript focus:outline-none bg-white border border-[#C7C7C7] flex flex-col w-[816px] pt-10 pr-14 pb-10 cursor-text'
				}
			},
			autofocus: 'end',
			extensions: editorExtensions,
			content: await getDocumentData(),

			onUpdate: ({ editor }) => {
				words = countDocument(editor.state.doc);

				// A file that could not be parsed is left alone. Saving over it would
				// replace whatever was recoverable with an empty document, which is
				// the opposite of what someone whose file just failed to open needs.
				if (readFailed) return;

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

	/**
	 * Export as PDF, through the webview's own print.
	 *
	 * What is on screen is what comes out, which is the point for researchers
	 * arriving from Word: the editor already renders an 816px page — US Letter at
	 * 96dpi — so the model was right, it just had no print stylesheet.
	 *
	 * The previous implementation rendered `magnum_opus.html` through a headless
	 * Chrome. Nothing ever wrote that file, so it had never worked, and requiring
	 * a Chrome install contradicts the whole premise of an offline-first app.
	 * `window.print()` reaches the OS print sheet, which is where "Save as PDF"
	 * lives, and needs nothing installed.
	 */
	/**
	 * Write a LaTeX bundle beside the manuscript, and compile it if this machine
	 * can.
	 *
	 * Journals routinely ask for `.tex` alongside the PDF, and some supply a
	 * class file the paper must be built with. Erti does not ship TeX Live —
	 * several gigabytes for the minority who compile locally — so the bundle is
	 * the deliverable and compiling is an offer.
	 */
	async function exportToLatex() {
		await autosave.flush();
		$editor.commands.updateAllCitation();

		const current = $documentsStore.current;
		if (!current) return;

		try {
			const doc = $editor.getJSON();

			// Only the works this manuscript cites: a .bib of the whole library
			// lists papers it never mentions, and some journals check.
			const cited: string[] = [];
			$editor.state.doc.descendants((node) => {
				if (node.type.name === 'citation') cited.push(...parseCitationIds(node.attrs.id));
				return true;
			});

			const { bibtex, keys } = toBibliography(citationStore.getAllSourcesAsJson(), cited);

			const dir = await pathJoin(currentDir, 'export');
			await mkdir(dir, { recursive: true });

			await writeTextFile(
				await pathJoin(dir, 'main.tex'),
				toLatexDocument(doc, { title: current.title, citationKeys: keys })
			);
			await writeTextFile(await pathJoin(dir, 'references.bib'), bibtex);

			const tex = await invoke<{ engine: string | null }>('detect_tex_toolchain');

			if (!tex.engine) {
				// Said rather than hidden: the bundle is the useful artefact, and
				// Overleaf is where most co-authors will open it.
				successToast(
					`Wrote export/main.tex and references.bib. No LaTeX installation was found, so it was not compiled — the folder is ready to upload to Overleaf or send to a journal.`
				);
				return;
			}

			const result = await invoke<{ ok: boolean; log: string }>('compile_latex', {
				directory: dir,
				engine: tex.engine
			});

			if (result.ok) {
				successToast(`Compiled export/main.pdf with ${tex.engine}.`);
			} else {
				// The log is the only thing that says what went wrong.
				console.error(result.log);
				errorToast(
					`${tex.engine} could not compile the document. The bundle is in export/ and the log is in the console.`
				);
			}
		} catch (error) {
			console.error('LaTeX export failed:', error);
			errorToast(
				`Could not write the LaTeX bundle: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	async function exportToPdf() {
		// Anything still in the quiet period is written first, so the PDF and the
		// file on disk are the same document.
		await autosave.flush();

		// The citations and the works-cited list are rendered from the document, so
		// they must be current before it is committed to paper.
		$editor.commands.updateAllCitation();

		window.print();
	}

	async function getDocumentData(path?: string) {
		const target = path ?? get(documentsStore).current?.path;
		if (!target || !(await exists(target))) {
			return {};
		}

		const fileData = await readTextFile(target);

		if (!fileData.trim() || fileData === 'undefined') {
			console.warn(`${target} is empty; starting from a blank document.`);
			return {};
		}

		try {
			return JSON.parse(fileData);
		} catch (parseError) {
			// Refuse rather than silently replacing the file with a blank document
			// on the next save, which would destroy whatever was recoverable.
			console.error(`Could not read ${target}:`, parseError);
			errorToast(
				`${target.split('/').pop()} could not be read. It has been left untouched — open it in a text editor to check.`
			);
			readFailed = true;
			return {};
		}
	}

	/**
	 * Put a different manuscript in the editor.
	 *
	 * The outgoing one is written first, and its failure stops the switch: moving
	 * on would leave those edits with nowhere to go, since the autosave resolves
	 * its target at write time.
	 */
	async function openDocument(next: ProjectDocument) {
		if (next.path === $documentsStore.current?.path) return;

		// Two quick clicks both get past the guard and both await. A slower first
		// read finishing last would put one manuscript's text on screen while
		// autosave — which resolves its target at write time — pointed at the
		// other, and the next keystroke would write the wrong file. The token is
		// what makes a superseded switch abandon itself.
		const token = ++transition;

		const saved = await autosave.flush();
		if (!saved) {
			errorToast('Could not save the current document, so it stayed open.');
			return;
		}
		if (token !== transition) return;

		const content = await getDocumentData(next.path);
		if (token !== transition) return;

		readFailed = false;
		documentsStore.open(next);
		$editor.commands.setContent(content);
		$editor.commands.updateAllCitation();
	}

	/** An empty manuscript, written only if that name is genuinely free. */
	async function createOnDisk(path: string): Promise<boolean> {
		try {
			// createNew rather than a prior exists() check: the gap between looking
			// and writing is enough to overwrite a file that appeared in between,
			// and the name check runs against a directory listing that may already
			// be stale. Losing a co-author's chapter to a race is not recoverable,
			// so the filesystem decides rather than a cached list.
			await writeTextFile(path, JSON.stringify({ type: 'doc', content: [] }), {
				createNew: true
			});
			return true;
		} catch (error) {
			console.error(`Could not create ${path}:`, error);
			return false;
		}
	}

	/** The manuscript a brand-new project starts with. */
	async function createFirstDocument() {
		const fileName = `Untitled${DOCUMENT_EXTENSION}`;
		const path = await pathJoin(currentDir, fileName);

		// An existing file here is not a failure: it is the manuscript to open.
		if (!(await exists(path))) await createOnDisk(path);

		documentsStore.add({ fileName, path, title: 'Untitled', legacy: false });
	}

	async function createDocument(name: string) {
		const result = toDocumentFileName(
			name,
			$documentsStore.documents.map((d) => d.fileName)
		);

		if (!result.ok) {
			errorToast(result.reason!);
			return;
		}

		const token = ++transition;

		const saved = await autosave.flush();
		if (!saved) {
			errorToast('Could not save the current document, so the new one was not created.');
			return;
		}
		if (token !== transition) return;

		const path = await pathJoin(currentDir, result.fileName!);
		// Written straight away so the manuscript exists on disk even if the app
		// closes before anything is typed into it.
		if (!(await createOnDisk(path))) {
			errorToast(
				`Could not create "${result.fileName}". A file of that name may already be there — refresh and try again.`
			);
			await fileSystemStore.readDirectory(currentDir);
			documentsStore.refresh();
			return;
		}
		if (token !== transition) return;

		readFailed = false;
		documentsStore.add({
			fileName: result.fileName!,
			path,
			title: result.fileName!.replace(DOCUMENT_EXTENSION, ''),
			legacy: false
		});

		$editor.commands.setContent({ type: 'doc', content: [] });
		await fileSystemStore.readDirectory(currentDir);
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
			<DocumentBar
				documents={$documentsStore.documents}
				current={$documentsStore.current}
				onopen={openDocument}
				oncreate={createDocument}
			/>

			<ToolBar editor={$editor} {toggleView} {exportToPdf} {exportToLatex} />

			<!--
				Whether the work is safe. A failed save keeps the content and retries,
				so the message says that rather than implying the work is gone — and
				it stays put instead of disappearing like a toast, because it is the
				one thing the user must not miss.
			-->
			<div class="flex items-center justify-end gap-4 px-4 pb-1 text-xs">
				<!--
					Body words, with the references counted separately: a journal's
					limit applies to the text, and folding the works cited into one
					total would report an author as over a limit they had not crossed.
				-->
				<span class="text-gray-400" title="{words.references} words in references and notes">
					{words.body.toLocaleString()}
					{words.body === 1 ? 'word' : 'words'}
					{#if wordTarget > 0}
						<span class:text-orange-600={progressTo(words.body, wordTarget).remaining < 0}>
							/ {wordTarget.toLocaleString()}
						</span>
					{/if}
				</span>

				<span aria-live="polite">
					{#if saveState === 'error'}
						<span class="font-medium text-red-600">Not saved — retrying, your work is kept</span>
					{:else if saveState === 'saving'}
						<span class="text-gray-500">Saving…</span>
					{:else if saveState === 'pending'}
						<span class="text-gray-400">Unsaved changes</span>
					{:else}
						<span class="text-gray-400">Saved</span>
					{/if}
				</span>
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
