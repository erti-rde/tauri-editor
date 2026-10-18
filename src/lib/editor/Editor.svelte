<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';

	import { citationStore } from '$lib/stores/citationStore';
	import { errorToast, toast } from '$lib/ui/Toast.svelte';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { fileSystemStore } from '$lib/stores/fileSystem.svelte';
	import { join as pathJoin } from '@tauri-apps/api/path';
	import { call, commands, describeError, run } from '$lib/ipc';

	import { get } from 'svelte/store';

	import { createAutosave } from './autosave';
	import { cursorMemory, cursorPosition, waitingCite } from './citeLater';
	import { citeWork } from './citeWork';
	import { createManuscriptSession } from '$lib/manuscript/io';
	import { citedIds, snapshotSources } from '$lib/manuscript/format';
	import AwayCitationTip from './AwayCitationTip.svelte';
	import { readSetting } from '$lib/settings';
	import { countDocument, countSavedWords } from './wordCount';
	import { documentStatus } from '$lib/statusFooter/documentStatus';
	import { createExports } from '$lib/export/exports';
	import {
		DOCUMENT_EXTENSION,
		listDocuments,
		toDocumentFileName,
		type ProjectDocument
	} from './documents';
	import { documentsStore, requested } from '$lib/stores/documents.svelte';
	import createEditor from './core/CreateEditor';
	import DocumentBar from './DocumentBar.svelte';
	import ManuscriptFind from './ManuscriptFind.svelte';
	import { Editor } from './core/Editor';
	import EditorContent from './core/EditorContent.svelte';
	import { paginatedExtensions } from './core/extensions';
	import { applyPageSetup, observePageCount, pageSetupStore, paperById } from './pagination';
	import { zoomStore } from './pagination/zoom';
	import { createReferencesWatcher } from './references/autoReferences';
	import { countCitations, readDocumentShape } from './references/documentShape';
	import { autoReferences } from './references/referencesStore';
	import { readOutline, headingAt, sameOutline } from '$lib/outline/outline';
	import { outlineStore } from '$lib/outline/outlineStore';
	import { createFollower, draftContext, draftMatches, nudgeFor } from '$lib/notes/draftContext';
	import { showNudge } from './extensions/NoteNudge';
	import { attributionCheck } from '$lib/attribution/check.svelte';
	import { checkEditor, type CheckEditor } from './checkEditor';
	import { nudgeSetting } from '$lib/notes/writingSettings';
	import { createSnapshots } from '$lib/history/snapshots';
	import { historyView } from '$lib/history/historyStore.svelte';

	import type { EditorState } from '@tiptap/pm/state';
	import type { Readable } from 'svelte/store';
	import BubbleMenu from './extensions/BubbleMenu.svelte';
	import Result from './extensions/citation/Result.svelte';
	import ToolBar from './extensions/ToolBar.svelte';
	import { log } from '$lib/log';

	let editor = $state() as Readable<Editor>;
	let editable = $state(true);
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
	let stopWaiting: (() => void) | undefined;
	/**
	 * The manuscript this editor holds, fixed when it's read: the cursor is
	 * remembered under it, not under whatever the store says is current by
	 * the time the writer moves it.
	 */
	let loadedPath: string | undefined;
	let checkBridge: CheckEditor | null = null;

	/** A path's file name: what the attribution check calls a document. */
	const fileNameOf = (path: string | undefined) => path?.split(/[\\/]/).pop() ?? null;
	/** Set on teardown: onMount awaits, and must not finish on an editor that's gone. */
	let destroyed = false;

	/** The find bar (UX-11): whether it's open, and whether it replaces too. */
	let finding = $state(false);
	let replacing = $state(false);
	let findBar: ManuscriptFind | undefined = $state();
	let root: HTMLElement | undefined = $state();

	/**
	 * Once Tiptap has run its own mount-time focus, which sets the selection a
	 * tick after mounting and then emits `create`. After that the cursor stays
	 * where a citation leaves it.
	 */
	function initialised(instance: Editor): Promise<void> {
		if (instance.isInitialized) return Promise.resolve();
		return new Promise((resolve) => {
			const done = () => {
				instance.off('create', done);
				resolve();
			};
			instance.on('create', done);
		});
	}
	/**
	 * Loads and saves manuscripts, and refuses to save over one it couldn't read
	 * (`$lib/manuscript/io`).
	 */
	const manuscript = createManuscriptSession();

	/**
	 * Set when the open file was saved by a newer Erti: the version that wrote
	 * it, if it said. Shown read-only and never saved (M1a-8 AC-4), since this
	 * build can't know what it would lose.
	 */
	let newerFile = $state<string | null>(null);

	/** Editable if the user wants it and the file allows it. */
	function applyEditable() {
		// Without an update: changing whether the page can be edited isn't an
		// edit, and an update here was counted as a citation arriving.
		$editor?.setEditable(editable && newerFile === null, false);
	}

	/** Bumped on each document switch, so a superseded one abandons itself. */
	let transition = 0;

	/**
	 * The number a researcher is actually writing to.
	 *
	 * Settings has persisted a target since before this work began and nothing
	 * ever read it, so the figure that decides whether a paper can be submitted
	 * was invisible.
	 */

	/**
	 * Snapshots for the history (M5-1, ADR 007): after a save at most every ten
	 * minutes, and when the document closes. Only of what this editor wrote.
	 */
	const snapshots = createSnapshots(
		(path, trigger, words) => call(commands.takeSnapshot(path, trigger, words)),
		(path, error, first) => {
			log.error('Could not keep a snapshot', error);
			// Said once per document: the saves go on, and so do the attempts.
			if (!first) return;
			errorToast(
				`Could not keep a snapshot of “${fileNameOf(path)?.replace(DOCUMENT_EXTENSION, '')}” for its history: ${describeError(error).replace(/\.$/, '')}. The document itself is saved.`
			);
		}
	);

	const autosave = createAutosave({
		write: async (content) => {
			// Resolved at write time, not captured: switching documents changes
			// where the next save goes, and a stale path would write one
			// manuscript's text into another's file.
			const target = get(documentsStore).current;
			if (!target) return;

			// The sources cited, as they are now, go with the document (ADR 002):
			// a co-author without the PDFs still sees real citations.
			const sources = snapshotSources(
				citedIds(content),
				citationStore.getAllSourcesAsJson(),
				{},
				citationStore.canonicalId
			);
			if (!(await manuscript.save(target.path, content, sources))) return;
			// Awaited, so the next save can't land while the file is copied. A
			// snapshot that fails is said by `snapshots`, and never fails the save.
			snapshots.written(target.path, countSavedWords(content));
			await snapshots.writing(target.path);
		},
		onStateChange: (next) => documentStatus.report({ save: next }),
		onError: (error) => {
			// A failed save is the one thing the user must not miss. The content is
			// kept and retried on a backoff, so this says that rather than implying
			// the work is gone.
			log.error('Save failed', error);
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

		// Building the editor re-renders the citations it was opened with, which
		// is an update. It isn't the author adding a citation, so it mustn't
		// bring a reference list into a manuscript that had none.
		loadingContent = true;
		loadedPath = $documentsStore.current?.path;
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
					class: 'manuscript border border-line cursor-text',
					// Said, not left to the default (M5-3): WebKitGTK and WebView2
					// differ on whether a contenteditable is checked unasked.
					spellcheck: 'true'
				}
			},
			// Where the writer left off, if this manuscript was open before: the
			// editor is built afresh each time it's shown (M1b-8).
			autofocus: cursorMemory.recall(loadedPath) ?? 'end',
			extensions: paginatedExtensions(setup),
			content: await getDocumentData(loadedPath),

			onUpdate: ({ editor, transaction }) => {
				documentStatus.report({ words: countDocument(editor.state.doc) });
				// The writer's edits make a check stale (M4-5 AC-5). Relabelled
				// citations and a document loading aren't edits, and are kept out
				// of the history for that reason; a fix says so itself.
				if (!loadingContent && transaction.getMeta('addToHistory') !== false) {
					attributionCheck.edited();
				}
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
				// Under the manuscript this editor shows, which the store's current
				// one needn't be: another pane may have opened a different one.
				if (loadedPath) cursorMemory.remember(loadedPath, cursorPosition(editor.state.selection));
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
		// The Check panel's way in (M4-5): it reads the sentences, marks the one
		// a finding is about, and makes the fixes.
		checkBridge = checkEditor($editor, () => fileNameOf(loadedPath));
		attributionCheck.attach(checkBridge);

		// Last, so the page-setup effects only run once there is something to
		// apply a setup to. They cannot watch `editor` itself: it publishes on
		// every transaction, and applying a setup dispatches transactions.
		editorReady = true;
		citationsSeen = countCitations($editor.state.doc);
		loadingContent = false;
		applyEditable();

		// A citation asked for while the editor was away (the Sources view, M1b-8),
		// or while it's here: either way it goes in at the cursor.
		//
		// Not before Tiptap's own focus, which it runs a tick after mounting and
		// which puts the cursor back where the editor opened: in first, the
		// citation was left behind the cursor and the next words went before it.
		// And not on an editor already gone: onMount awaits above, and leaving
		// the manuscript meanwhile would leave a dead editor taking citations.
		if (destroyed) return;
		const ready = initialised($editor);
		stopWaiting = waitingCite.subscribe((cite) => {
			if (!cite) return;
			const taken = waitingCite.take();
			if (!taken) return;
			void ready.then(() => {
				if (!destroyed) void citeSource(taken.id, taken.locator ?? undefined);
			});
		});

		// Closing the window is the last chance to write, and `beforeunload` cannot
		// take it: the browser does not await a promise, so the webview can go away
		// mid-write and lose the work. Tauri's close request can be held open,
		// which turns best-effort into an actual guarantee.
		unlistenClose = await getCurrentWindow().onCloseRequested(async (event) => {
			const open = get(documentsStore).current?.path;
			const owed = open !== undefined && snapshots.pending(open);
			if (!autosave.hasUnsavedChanges && !owed) return;

			event.preventDefault();
			const saved = await autosave.flush();

			if (!saved) {
				// The disk refused. Closing now would discard the work silently, so
				// the window stays open with the failure on screen.
				errorToast('Could not save your document, so the window was kept open. Try again.');
				return;
			}

			// The work is saved; a snapshot that fails now is said, and doesn't
			// keep the window open.
			const path = get(documentsStore).current?.path;
			if (path) await snapshots.closing(path, 'quit');
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
		destroyed = true;
		// The panel outlives the editor too, and a stale `navigate` would call into
		// a destroyed view.
		outlineStore.clear();
		follower.stop();
		draftContext.clear();
		// The bar outlives the editor, so a closed manuscript must not leave a
		// stale count sitting in it.
		documentStatus.clear();
		if (checkBridge) attributionCheck.detach(checkBridge);
		// Best-effort: a component teardown cannot be awaited. The close handler
		// above is what actually guarantees the write; this covers switching away
		// from a document while the app stays open. Then its snapshot, on close.
		const leaving = get(documentsStore).current?.path;
		void autosave.flush().then((saved) => {
			if (saved && leaving) void snapshots.closing(leaving, 'close');
		});
		unlistenClose?.();
		stopWaiting?.();
		autosave.destroy();
	});

	function toggleView() {
		editable = !editable;
		applyEditable();
	}

	const exports = createExports({
		editor: () => $editor,
		flush: () => autosave.flush(),
		title: () => $documentsStore.current?.title ?? null,
		directory: () => currentDir
	});

	async function getDocumentData(path?: string) {
		const target = path ?? get(documentsStore).current?.path;
		if (!target) return {};

		const loaded = await manuscript.open(target);
		// Its own sources render the citations this library can't (UX-12).
		citationStore.setManuscriptSources(loaded.sources);
		newerFile = loaded.status === 'newer' ? (loaded.savedWith ?? 'a newer version of Erti') : null;
		applyEditable();
		if (loaded.status === 'empty') {
			log.warn(`${target} is empty; starting from a blank document`);
		}
		if (loaded.status === 'unreadable') {
			log.error(`Could not read ${target}`, loaded.error);
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
		const leaving = $documentsStore.current?.path;
		if (leaving) await snapshots.closing(leaving, 'close');
		if (token !== transition) return;

		// Not followed by lifting the guard: an unreadable chapter opened this way
		// used to be saved over, blank, on the next keystroke.
		const content = await getDocumentData(next.path);
		if (token !== transition) return;

		documentsStore.open(next);
		loadedPath = next.path;
		// Before the content changes, so the old check isn't marked stale by a
		// switch: it's for the other document now.
		attributionCheck.opened(fileNameOf(next.path));
		loadingContent = true;
		$editor.commands.setContent(content);
		// Where the writer left off in this one, as on opening the editor: a
		// citation asked for next goes there, not wherever setContent left it.
		const remembered = cursorMemory.recall(next.path);
		if (remembered !== undefined) {
			const max = $editor.state.doc.content.size;
			$editor.commands.setTextSelection(Math.min(remembered, max));
		}
		loadingContent = false;
		citationsSeen = countCitations($editor.state.doc);
		$editor.commands.updateAllCitation();
		// A dismissal belongs to the document it was made in. Without this,
		// deleting the reference list in one chapter would suppress it in every
		// chapter opened afterwards.
		references.reset();
	}

	/**
	 * Show the document's history in the workspace (UX-9). Saved first, and its
	 * snapshot taken if it changed, so the newest snapshot is what's on screen
	 * and a restore can't race a save still under way.
	 */
	async function showHistory() {
		const current = $documentsStore.current;
		if (!current) return;
		// Read-only until History replaces it: a keystroke while saving would
		// land after the snapshot History shows as the newest.
		$editor.setEditable(false, false);
		const saved = await autosave.flush();
		if (!saved) {
			applyEditable();
			errorToast('Could not save the current document, so its history was not opened.');
			return;
		}
		await snapshots.closing(current.path, 'close');
		historyView.open(current);
	}

	/**
	 * ⌘F opens find, ⌘⌥F find and replace, and Esc in the manuscript closes it
	 * (M5-2 AC-1). On the window, so the keys work from the bar's own fields
	 * too, but only for keys pressed in the editor: the reader beside it isn't
	 * the manuscript.
	 */
	function onWindowKey(event: KeyboardEvent) {
		if (!editorReady) return;
		const target = event.target as Node | null;
		const inEditor = target === document.body || (!!target && !!root?.contains(target));
		if (!inEditor || event.defaultPrevented) return;

		// `code`, not `key`: ⌥F types "ƒ" on a Mac.
		const mod = event.metaKey || event.ctrlKey;
		if (mod && !event.shiftKey && event.code === 'KeyF') {
			event.preventDefault();
			if (event.altKey) replacing = true;
			else if (!finding) replacing = false;
			if (finding) findBar?.focus();
			finding = true;
		} else if (finding && event.key === 'Escape' && !mod) {
			event.preventDefault();
			finding = false;
			$editor.commands.focus();
		}
	}

	/** An empty manuscript, written only if that name is genuinely free. */
	async function createOnDisk(path: string): Promise<boolean> {
		const result = await manuscript.create(path);
		if (!result.created) log.error(`Could not create ${path}`, result.error);
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
		const leaving = $documentsStore.current?.path;
		if (leaving) await snapshots.closing(leaving, 'close');
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
		// What `getDocumentData` would say of a blank file: it wasn't saved by a
		// newer Erti and carries no sources. Left alone, the new document stayed
		// read-only under the last one's banner.
		citationStore.setManuscriptSources({});
		newerFile = null;
		applyEditable();
		documentsStore.add({
			fileName: result.fileName!,
			path,
			title: result.fileName!.replace(DOCUMENT_EXTENSION, ''),
			legacy: false
		});

		// As on opening one: the Check panel's result was for the other
		// document, and a check now must leave this one out of its corpus.
		loadedPath = path;
		attributionCheck.opened(fileNameOf(path));
		$editor.commands.setContent({ type: 'doc', content: [] });
		citationsSeen = 0;
		await fileSystemStore.readDirectory(currentDir);
	}

	/**
	 * Rename the open document, in its tab (M5-7). Saved first and held still
	 * while it moves: a save landing midway would write the old name back.
	 * Its history moves with it, on disk.
	 */
	async function renameDocument(name: string) {
		const renaming = $documentsStore.current;
		if (!renaming) return;
		const others = $documentsStore.documents.filter((d) => d.path !== renaming.path);
		const result = toDocumentFileName(
			name,
			others.map((d) => d.fileName)
		);
		if (!result.ok) {
			errorToast(result.reason!);
			return;
		}
		if (result.fileName === renaming.fileName) return;

		++transition;
		$editor.setEditable(false, false);
		if (!(await autosave.flush())) {
			applyEditable();
			errorToast(`Could not save “${renaming.title}”, so it kept its name.`);
			return;
		}
		try {
			await call(commands.renameDocument(renaming.path, result.fileName!));
		} catch (error) {
			applyEditable();
			errorToast(`Couldn’t rename “${renaming.title}”`, describeError(error));
			return;
		}

		// Joined here rather than taken from Rust's reply, which resolves links:
		// the folder listing names it this way, and a path that differs from it
		// would read as a document gone.
		const path = await pathJoin(currentDir, result.fileName!);
		documentsStore.renamed(renaming.path, {
			fileName: result.fileName!,
			path,
			title: result.fileName!.replace(DOCUMENT_EXTENSION, ''),
			legacy: false
		});
		// The guard against saving over a file this build can't read follows
		// the file to its new name.
		await manuscript.open(path);
		loadedPath = path;
		cursorMemory.remember(path, cursorPosition($editor.state.selection));
		attributionCheck.opened(fileNameOf(path));
		applyEditable();
		await fileSystemStore.readDirectory(currentDir);
	}

	/** A copy of the open document beside it, offered rather than opened (M5-7). */
	async function duplicateDocument() {
		const original = $documentsStore.current;
		if (!original) return;
		if (!(await autosave.flush())) {
			errorToast(`Could not save “${original.title}”, so it wasn’t copied.`);
			return;
		}
		let copy: ProjectDocument | undefined;
		try {
			const written = await call(commands.duplicateDocument(original.path));
			const path = await pathJoin(currentDir, fileNameOf(written)!);
			await fileSystemStore.readDirectory(currentDir);
			documentsStore.refresh();
			copy = get(documentsStore).documents.find((d) => d.path === path);
		} catch (error) {
			errorToast(`Couldn’t copy “${original.title}”`, describeError(error));
			return;
		}
		if (!copy) return;
		const made = copy;
		toast({
			kind: 'success',
			title: `Made “${made.title}”`,
			action: { label: 'Open', run: () => void openDocument(made) }
		});
	}

	/**
	 * Move the open document to the bin, once the writer has said so (M5-7).
	 * Saved and its snapshot taken first, so what's put back from the bin, and
	 * what History keeps, is what was on screen. Then another opens, or a new
	 * one when it was the last.
	 */
	async function deleteDocument() {
		const doomed = $documentsStore.current;
		if (!doomed) return;
		++transition;
		$editor.setEditable(false, false);
		if (!(await autosave.flush())) {
			applyEditable();
			errorToast(`Could not save “${doomed.title}”, so it wasn’t deleted.`);
			return;
		}
		await snapshots.closing(doomed.path, 'close');
		try {
			await run(commands.trashDocument(doomed.path));
		} catch (error) {
			applyEditable();
			errorToast(`Couldn’t delete “${doomed.title}”`, describeError(error));
			return;
		}

		// The folder read again first, so the next document is one that's on
		// disk and a new "Untitled" is checked against what's there. A listing
		// that couldn't be read isn't used: it would still hold this document.
		await fileSystemStore.readDirectory(currentDir);
		const listing = get(fileSystemStore);
		documentsStore.removed(doomed.path, listing.error ? undefined : listDocuments(listing.items));
		const next = get(documentsStore).documents[0];
		if (next) await openDocument(next);
		else await createDocument('Untitled');
		toast({
			kind: 'success',
			title: `Moved “${doomed.title}” to the bin`,
			description: 'Its history stays with the project.'
		});
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
	 * Tell the notes panel what is being written (M3-1 AC-3).
	 *
	 * When the cursor leaves a paragraph, and otherwise after a pause in it,
	 * never per keystroke: each publish costs the panel an embedding and a
	 * search, and it would churn through half-formed matches while a sentence is
	 * still being made. Waiting for a pause is also closer to when the question
	 * "have I read anything about this" actually occurs to someone.
	 */
	const follower = createFollower((followed) => draftContext.report(followed));

	function publishDraftContext(instance: { state: EditorState }) {
		follower.update(instance.state.doc, instance.state.selection.from, citationStore.canonicalId);
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
	 * as removed (`citeWork`).
	 */
	function citeSource(id: string, locator?: string) {
		return citeWork($editor, id, locator);
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

			showNudge(
				view,
				$nudgeSetting
					? nudgeFor(doc, selection.from, matches, citationStore.canonicalId)
					: { pos: null, count: 0 }
			);
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
			// Quietly: the writer is mid-sentence, and the cursor stays there.
			$editor.commands.insertBibliography({ quietly: true });
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

<svelte:window onkeydown={onWindowKey} />

{#if $editor}
	<div bind:this={root} class="bg-surface flex h-full w-full flex-col">
		<div class="z-10 mb-1 shrink-0">
			<DocumentBar
				documents={$documentsStore.documents}
				current={$documentsStore.current}
				onopen={openDocument}
				oncreate={createDocument}
				onhistory={showHistory}
				onrename={renameDocument}
				onduplicate={duplicateDocument}
				ondelete={deleteDocument}
			/>

			<ToolBar editor={$editor} {toggleView} {exports} />
		</div>

		<!-- The editor used to refuse to open when citations couldn't be set up,
		     so a fresh install couldn't write at all (M0-3). Now it opens, and
		     says plainly what's wrong. Moves onto the Banner primitive in M1c. -->
		{#if newerFile !== null}
			<p
				role="status"
				class="border-line bg-surface-raised text-ink-muted shrink-0 border-b px-4 py-1.5 text-xs"
			>
				<span class="text-warning font-medium">This document was saved by a newer Erti.</span>
				It was written by {newerFile}. It's open read-only, so nothing in it can be lost here;
				update Erti to edit it.
			</p>
		{/if}

		{#if $citationStore.error}
			<p
				role="status"
				class="border-line bg-surface-raised text-ink-muted shrink-0 border-b px-4 py-1.5 text-xs"
			>
				<span class="text-warning font-medium">Citations can't be formatted.</span>
				{$citationStore.error}
			</p>
		{/if}

		<!-- The find bar sits over the top of the manuscript, outside the zoom,
		     so it stays the size of the rest of the interface. -->
		<div class="relative flex min-h-0 grow flex-col">
			{#if finding && editorReady}
				<ManuscriptFind
					bind:this={findBar}
					bind:replacing
					editor={$editor}
					readOnly={!editable || newerFile !== null}
					onclose={() => (finding = false)}
				/>
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
		<!-- Outside the zoomed area: the tip is placed in viewport coordinates,
		     which zoom would scale a second time. -->
		<AwayCitationTip
			root={editorReady ? $editor.view.dom : undefined}
			onadded={() => $editor.commands.updateAllCitation()}
		/>
	</div>
{/if}
