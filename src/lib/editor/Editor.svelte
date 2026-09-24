<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';

	import { citationStore } from '$lib/stores/citationStore';
	import { addToProject } from '$lib/stores/db';
	import { errorToast, successToast } from '$lib/toast/Toast.svelte';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { fileSystemStore } from '$lib/stores/fileSystem.svelte';
	import { join as pathJoin } from '@tauri-apps/api/path';
	import { mkdir, writeTextFile } from '@tauri-apps/plugin-fs';
	import { call, commands } from '$lib/ipc';

	import { get } from 'svelte/store';

	import { createAutosave } from './autosave';
	import { createManuscriptSession } from '$lib/manuscript/io';
	import { readSetting } from '$lib/settings';
	import { countDocument } from './wordCount';
	import { documentStatus } from '$lib/statusFooter/documentStatus';
	import { parseCitationIds } from '$lib/citations/document';
	import { toBibliography } from '$lib/export/bibtex';
	import { toLatexDocument } from '$lib/export/latex';
	import { DOCUMENT_EXTENSION, toDocumentFileName, type ProjectDocument } from './documents';
	import { documentsStore, requested } from '$lib/stores/documents.svelte';
	import createEditor from './core/CreateEditor';
	import DocumentBar from './DocumentBar.svelte';
	import { Editor } from './core/Editor';
	import EditorContent from './core/EditorContent.svelte';
	import { paginatedExtensions } from './core/extensions';
	import {
		applyPageSetup,
		observePageCount,
		pageSetupStore,
		paperById,
		toLatexPageSetup
	} from './pagination';
	import { zoomStore } from './pagination/zoom';
	import { createReferencesWatcher } from './references/autoReferences';
	import { countCitations, readDocumentShape } from './references/documentShape';
	import { autoReferences } from './references/referencesStore';
	import { readOutline, headingAt, sameOutline } from '$lib/outline/outline';
	import { outlineStore } from '$lib/outline/outlineStore';
	import {
		citedSources,
		draftContext,
		draftMatches,
		paragraphAt,
		worthNudging
	} from '$lib/notes/draftContext';
	import { showNudge } from './extensions/NoteNudge';
	import { nudgeSetting } from '$lib/notes/nudgeSetting';

	import type { EditorState } from '@tiptap/pm/state';
	import type { Readable } from 'svelte/store';
	import BubbleMenu from './extensions/BubbleMenu.svelte';
	import Result from './extensions/citation/Result.svelte';
	import ToolBar from './extensions/ToolBar.svelte';

	let editor = $state() as Readable<Editor>;
	let editable = true;
	let currentDir = '';
	/**
	 * Set once the editor exists.
	 *
	 * The page-setup effects need to know there is an editor without reading
	 * the store that holds it — that store publishes on every transaction, and
	 * an effect which both reads it and dispatches transactions never settles.
	 */
	let editorReady = $state(false);

	/**
	 * Autosave, which has to keep every keystroke.
	 *
	 * The previous version cancelled the pending save on each update and then
	 * returned without scheduling anything if a write was in flight, so edits
	 * made during a write were dropped — permanently, if the user stopped typing
	 * there. The logic now lives in ./autosave with tests for that race.
	 */
	let unlistenClose: (() => void) | undefined;
	/**
	 * Loads and saves manuscripts, and refuses to save over one it couldn't read
	 * (`$lib/manuscript/io`).
	 */
	const manuscript = createManuscriptSession();
	/** Bumped on each document switch, so a superseded one abandons itself. */
	let transition = 0;

	/**
	 * The number a researcher is actually writing to.
	 *
	 * Settings has persisted a target since before this work began and nothing
	 * ever read it, so the figure that decides whether a paper can be submitted
	 * was invisible.
	 */

	const autosave = createAutosave({
		write: async (content) => {
			// Resolved at write time, not captured: switching documents changes
			// where the next save goes, and a stale path would write one
			// manuscript's text into another's file.
			const target = get(documentsStore).current;
			if (!target) return;

			await manuscript.save(target.path, content);
		},
		onStateChange: (next) => documentStatus.report({ save: next }),
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

		documentStatus.report({
			target: await readSetting('wordCount')
		});

		// Before the editor is built: pagination has to be configured with the
		// paper size, and reading it afterwards would lay the first document out
		// as Letter and then reflow it.
		await pageSetupStore.initialise();
		await autoReferences.initialise();
		const setup = get(pageSetupStore);

		editor = createEditor({
			editorProps: {
				attributes: {
					// Width and padding come from the page setup now. They were
					// hard-coded to US Letter, so choosing A4 would have left the text
					// column at Letter's width on an A4 sheet.
					style: `width: ${paperById(setup.paper).widthPx}px`,
					// No `flex`: the paginator positions each page break with `float`
					// and `clear`, and floats are ignored inside a flex container —
					// every break became a flex item a full page tall, pushing the
					// text 13,000px down a 14,835px-high "page".
					class: 'manuscript border border-line cursor-text'
				}
			},
			autofocus: 'end',
			extensions: paginatedExtensions(setup),
			content: await getDocumentData(),

			onUpdate: ({ editor }) => {
				documentStatus.report({ words: countDocument(editor.state.doc) });
				noticeNewCitations(editor.state.doc);
				publishOutline(editor);
				publishDraftContext(editor);

				// A file that could not be parsed is left alone. Saving over it would
				// replace whatever was recoverable with an empty document, which is
				// the opposite of what someone whose file just failed to open needs.
				if (!manuscript.mayWrite(get(documentsStore).current?.path)) return;

				// The getter is passed rather than the content: it is read when the
				// save actually runs, so a burst of typing costs one write and always
				// writes the newest document.
				autosave.schedule(() => editor.getJSON());
			},

			// Moving the cursor changes which section the reader is in without
			// changing the document, so onUpdate never fires for it.
			onSelectionUpdate: ({ editor }) => {
				publishOutline(editor);
				publishDraftContext(editor);
			}
		});

		// The panel is a sibling in the layout rather than a child, so this is how
		// it reaches back in: only the editor holds the view, and scrolling to a
		// document position needs the view rather than the document.
		outlineStore.report({
			navigate: (pos) => {
				$editor.chain().focus().setTextSelection(pos).scrollIntoView().run();
			}
		});
		publishOutline($editor);
		publishDraftContext($editor);
		draftContext.report({ cite: citeSource });

		// Last, so the page-setup effects only run once there is something to
		// apply a setup to. They cannot watch `editor` itself: it publishes on
		// every transaction, and applying a setup dispatches transactions.
		editorReady = true;
		citationsSeen = countCitations($editor.state.doc);

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

	/**
	 * Re-lay the pages when the setup changes.
	 *
	 * Settings applies immediately rather than on Save, and page setup is a
	 * choice nobody can evaluate without seeing it — a 1.5in margin is an
	 * abstraction until the text column narrows in front of you.
	 *
	 * `$editor` is deliberately read through `untrack`. It is a store that
	 * publishes on *every* editor transaction, and applying a setup dispatches
	 * transactions — so reading it here reactively made this effect its own
	 * trigger and Svelte stopped it with `effect_update_depth_exceeded`. The
	 * setup is the only thing this should react to; `editorReady` is what says
	 * there is something to apply it to.
	 */
	$effect(() => {
		const setup = $pageSetupStore;
		if (!editorReady) return;

		const instance = untrack(() => $editor);
		if (!instance) return;

		applyPageSetup(instance, setup);
		// The element's own width is not the paginator's business, and it has to
		// track the paper or an A4 document sits in a Letter-wide column.
		instance.view.dom.style.width = `${paperById(setup.paper).widthPx}px`;
	});

	/**
	 * Keep the page count current, for "{total}" and for the status bar.
	 *
	 * Same reason for `untrack`: tracking `$editor` would tear down and rebuild
	 * the observer on every keystroke, which is both wasteful and a way to miss
	 * the mutation it was watching for.
	 */
	$effect(() => {
		if (!editorReady) return;

		const instance = untrack(() => $editor);
		if (!instance) return;

		return observePageCount(instance.view.dom as HTMLElement);
	});

	/**
	 * Open a manuscript the file tree or the tab strip asked for.
	 *
	 * They know which document was clicked but cannot open one: that means
	 * saving the outgoing manuscript, reading the new file and replacing the
	 * editor's content, none of which they have an editor for. So they leave a
	 * request and this performs it.
	 *
	 * `untrack` for the same reason as the effects above — `openDocument` reads
	 * the documents store and then writes to it, which would make this effect
	 * its own trigger.
	 */
	$effect(() => {
		const wanted = $requested;
		if (!wanted || !editorReady) return;

		// Cleared before the attempt, so a document that fails to open is not
		// retried on every subsequent update.
		documentsStore.taken();
		untrack(() => void openDocument(wanted));
	});

	onDestroy(() => {
		// The panel outlives the editor too, and a stale `navigate` would call into
		// a destroyed view.
		outlineStore.clear();
		clearTimeout(draftTimer);
		draftContext.clear();
		// The bar outlives the editor, so a closed manuscript must not leave a
		// stale count sitting in it.
		documentStatus.clear();
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
				toLatexDocument(doc, {
					title: current.title,
					citationKeys: keys,
					// The same paper, margins and spacing the PDF gets, so the two
					// exports are the same document.
					page: toLatexPageSetup(get(pageSetupStore))
				})
			);
			await writeTextFile(await pathJoin(dir, 'references.bib'), bibtex);

			const tex = await commands.detectTexToolchain();

			if (!tex.engine) {
				// Said rather than hidden: the bundle is the useful artefact, and
				// Overleaf is where most co-authors will open it.
				successToast(
					`Wrote export/main.tex and references.bib. No LaTeX installation was found, so it was not compiled — the folder is ready to upload to Overleaf or send to a journal.`
				);
				return;
			}

			const result = await call(commands.compileLatex(dir, tex.engine));

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
		if (!target) return {};

		const loaded = await manuscript.open(target);
		if (loaded.status === 'empty') {
			console.warn(`${target} is empty; starting from a blank document.`);
		}
		if (loaded.status === 'unreadable') {
			console.error(`Could not read ${target}:`, loaded.error);
			errorToast(
				`${target.split('/').pop()} could not be read. It has been left untouched — open it in a text editor to check.`
			);
		}
		return loaded.content;
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

		// Not followed by lifting the guard: an unreadable chapter opened this way
		// used to be saved over, blank, on the next keystroke.
		const content = await getDocumentData(next.path);
		if (token !== transition) return;

		documentsStore.open(next);
		loadingContent = true;
		$editor.commands.setContent(content);
		loadingContent = false;
		citationsSeen = countCitations($editor.state.doc);
		$editor.commands.updateAllCitation();
		// A dismissal belongs to the document it was made in. Without this,
		// deleting the reference list in one chapter would suppress it in every
		// chapter opened afterwards.
		references.reset();
	}

	/** An empty manuscript, written only if that name is genuinely free. */
	async function createOnDisk(path: string): Promise<boolean> {
		const result = await manuscript.create(path);
		if (!result.created) console.error(`Could not create ${path}:`, result.error);
		return result.created;
	}

	/** The manuscript a brand-new project starts with. */
	async function createFirstDocument() {
		const fileName = `Untitled${DOCUMENT_EXTENSION}`;
		const path = await pathJoin(currentDir, fileName);

		// An existing file here is not a failure: it is the manuscript to open.
		if (!(await manuscript.exists(path))) await createOnDisk(path);

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

		manuscript.reset();
		documentsStore.add({
			fileName: result.fileName!,
			path,
			title: result.fileName!.replace(DOCUMENT_EXTENSION, ''),
			legacy: false
		});

		$editor.commands.setContent({ type: 'doc', content: [] });
		citationsSeen = 0;
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

	/**
	 * The reference list, added by the first citation that needs one.
	 *
	 * Checked here rather than on every update: this is the only moment a
	 * document can gain its first citation, and walking a long manuscript on
	 * each keystroke to ask a question whose answer rarely changes is waste.
	 * A deletion is still caught, because the next citation sees that the list
	 * that was there has gone.
	 */
	const references = createReferencesWatcher();

	/**
	 * Keep the outline panel in step with the document.
	 *
	 * The headings are recomputed on every change and almost always come back
	 * identical — typing inside a paragraph cannot alter them — so they are
	 * compared before publishing. The cursor's section is cheap and does move
	 * constantly, so it is published on its own.
	 */
	let lastOutline: ReturnType<typeof readOutline> = [];

	// Typed by what it reads rather than by our Editor subclass: the callbacks
	// hand back TipTap's own Editor, which has no `contentElement`.
	/**
	 * Tell the notes panel what is being written, once the writer pauses.
	 *
	 * On idle rather than on every transaction. Publishing per keystroke would
	 * re-run a search — and an embedding — for every character typed, and the
	 * panel would churn through half-formed matches while a sentence is still
	 * being made. Waiting for a pause is also closer to when the question
	 * "have I read anything about this" actually occurs to someone.
	 */
	const DRAFT_IDLE_MS = 400;

	let draftTimer: ReturnType<typeof setTimeout> | undefined;

	function publishDraftContext(instance: { state: EditorState }) {
		clearTimeout(draftTimer);

		draftTimer = setTimeout(() => {
			draftContext.report({
				paragraph: paragraphAt(instance.state.doc, instance.state.selection.from)
			});
		}, DRAFT_IDLE_MS);
	}

	function publishOutline(instance: { state: EditorState }) {
		const headings = readOutline(instance.state.doc);
		const activePos = headingAt(headings, instance.state.selection.from)?.pos ?? null;

		if (sameOutline(headings, lastOutline)) {
			outlineStore.report({ activePos });
			return;
		}

		lastOutline = headings;
		outlineStore.report({ headings, activePos });
	}

	/**
	 * Cite the paper a note came from.
	 *
	 * The same path the citation panel takes, so citing from a note and citing
	 * from a search result are one action as far as the manuscript is concerned:
	 * the source joins the project if it was not in it, the engine is reloaded
	 * before the citation is inserted, and a source with no resolved metadata is
	 * refused with something to do about it rather than a citation that renders
	 * as removed.
	 */
	async function citeSource(sha256: string) {
		try {
			if (!citationStore.getAllSourcesAsJson()[sha256]) {
				await addToProject(sha256);
				await citationStore.initializeCitationStore();
			}

			if (!citationStore.getAllSourcesAsJson()[sha256]) {
				errorToast(
					'That paper has no citation details yet, so it cannot be cited. It has been added to this project — open the metadata explorer to paste a DOI or enter the details.'
				);
				return;
			}

			$editor.commands.insertCitation({
				id: JSON.stringify([sha256]),
				label: citationStore.previewCitation([sha256])
			});
		} catch (failure) {
			console.error('Could not cite that paper:', failure);
			errorToast('Could not cite that paper.');
		}
	}

	/**
	 * Put a mark beside the paragraph when there is a note about it going unused.
	 *
	 * The two halves of the question live apart on purpose: the panel can search
	 * and cannot read the document; this can read the document and cannot search.
	 * So the panel reports what it found and this decides whether it is worth
	 * saying — which mostly means checking whether the paragraph already cites it,
	 * because pointing at something the writer has plainly already used is the
	 * nagging that gets a feature switched off.
	 */
	$effect(() => {
		const matches = $draftMatches;
		// Read so turning the setting off clears any mark already on screen.
		void $nudgeSetting;
		if (!editorReady) return;

		untrack(() => {
			const view = $editor.view;
			const { doc, selection } = view.state;

			const resolved = doc.resolve(selection.from);
			const paragraph = resolved.parent;

			if (!$nudgeSetting || paragraph.textContent.trim() !== matches.paragraph) {
				showNudge(view, { pos: null, count: 0 });
				return;
			}

			const worth = worthNudging(matches.sources, citedSources(paragraph));

			showNudge(view, {
				pos: worth.length > 0 ? resolved.before(resolved.depth) : null,
				count: worth.length
			});
		});
	});

	/**
	 * The first citation brings a reference list with it, however it was made.
	 *
	 * This used to run only from the citation panel and the Cite buttons, so a
	 * citation typed through the `@` list, the usual way, never brought one.
	 * Loading a document isn't adding citations to it, so loads don't count.
	 */
	let citationsSeen = 0;
	let loadingContent = false;

	function noticeNewCitations(doc: typeof $editor.state.doc) {
		if (loadingContent) return;
		const count = countCitations(doc);
		const added = count > citationsSeen;
		citationsSeen = count;
		if (added) considerReferences();
	}

	function considerReferences() {
		const shape = readDocumentShape($editor.state.doc);

		if (references.observe({ enabled: $autoReferences, ...shape })) {
			$editor.commands.insertBibliography();
		}
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
	<div class="bg-surface flex h-full w-full flex-col">
		<div class="z-10 mb-1 shrink-0">
			<DocumentBar
				documents={$documentsStore.documents}
				current={$documentsStore.current}
				onopen={openDocument}
				oncreate={createDocument}
			/>

			<ToolBar editor={$editor} {toggleView} {exportToPdf} {exportToLatex} />
		</div>

		<!-- The editor used to refuse to open when citations couldn't be set up,
		     so a fresh install couldn't write at all (M0-3). Now it opens, and
		     says plainly what's wrong. Moves onto the Banner primitive in M1c. -->
		{#if $citationStore.error}
			<p
				role="status"
				class="border-line bg-surface-raised text-ink-muted shrink-0 border-b px-4 py-1.5 text-xs"
			>
				<span class="text-warning font-medium">Citations can't be formatted.</span>
				{$citationStore.error}
			</p>
		{/if}

		<!-- The zoom is set here rather than on the manuscript itself, so the
		     scrollable area shrinks with the page instead of leaving the reader
		     scrolling past the end of a document that visibly stopped. -->
		<div
			class="page-viewport bg-surface-sunken flex min-h-0 grow justify-center overflow-auto px-4 py-4"
			style="zoom: {$zoomStore}"
		>
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
