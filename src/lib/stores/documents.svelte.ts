import { writable, get } from 'svelte/store';

import { listDocuments, type ProjectDocument } from '$lib/editor/documents';
import { fileSystemStore } from '$lib/stores/fileSystem.svelte';

/**
 * Which manuscripts the open project has, and which one is being edited.
 *
 * The list is derived from the folder rather than stored, so a document a
 * co-author copied in, or one renamed in Finder, shows up without Erti having
 * to be told about it.
 */

interface DocumentsState {
	documents: ProjectDocument[];
	/** The manuscript in the editor. Null before a project is opened. */
	current: ProjectDocument | null;
}

/**
 * A manuscript someone has asked to open, waiting for the editor to do it.
 *
 * Separate from `current` because they mean different things: `current` is what
 * the editor is showing, and this is what it has been asked to show next.
 */
export const requested = writable<ProjectDocument | null>(null);

function createDocumentsStore() {
	const { subscribe, update, set } = writable<DocumentsState>({ documents: [], current: null });

	return {
		subscribe,

		/**
		 * Re-read the project's manuscripts from the folder listing.
		 *
		 * Keeps the current document selected if it is still there. If it has gone
		 * — deleted outside the app, or the project changed — the first document
		 * takes over rather than leaving the editor pointed at a missing file.
		 */
		refresh() {
			const documents = listDocuments(get(fileSystemStore).items);

			update((state) => {
				const stillThere =
					state.current && documents.find((d) => d.path === state.current!.path)
						? state.current
						: null;

				return { documents, current: stillThere ?? documents[0] ?? null };
			});

			return get(this).current;
		},

		/** Switch to a manuscript. The caller saves the outgoing one first. */
		open(document: ProjectDocument) {
			update((state) => ({ ...state, current: document }));
		},

		/**
		 * Ask for a manuscript to be opened, from somewhere that cannot open one.
		 *
		 * The file tree and the tab strip know which document you clicked, but
		 * opening one means saving the outgoing manuscript, reading the new file
		 * and replacing the editor's content — all of which needs the editor. They
		 * put the request here and the editor performs it.
		 *
		 * Deliberately not `open()`: that only moves the pointer. Setting `current`
		 * from outside makes the editor's own guard — "already current, nothing to
		 * do" — true before the content has been loaded, so the manuscript on
		 * screen would stay the old one under the new one's name.
		 */
		request(document: ProjectDocument) {
			requested.set(document);
		},

		/** Taken by the editor once the request has been carried out. */
		taken() {
			requested.set(null);
		},

		/** Add a manuscript that has just been written to disk, and open it. */
		add(document: ProjectDocument) {
			update((state) => ({
				documents: [...state.documents, document].sort((a, b) => {
					if (a.legacy !== b.legacy) return a.legacy ? -1 : 1;
					return a.title.localeCompare(b.title);
				}),
				current: document
			}));
		},

		reset() {
			set({ documents: [], current: null });
		}
	};
}

export const documentsStore = createDocumentsStore();
