import { get, writable } from 'svelte/store';

import type { PdfLocation } from './location';

/**
 * The open readers, and the way into them.
 *
 * Same idea as `outlineStore`: a reader publishes what it has and hands over a
 * way to jump, because only the reader holds the pdf.js viewer and scrolling to
 * a place needs the viewer, not the document.
 *
 * It differs in one way that matters. Exactly one editor may be open — a second
 * would autosave over the first — so `outlineStore` can hold a single navigate
 * function. A PDF has no such rule: `workspaceStore.split()` deliberately
 * duplicates a paper into both panes, so the same file can be on screen twice.
 * A single global navigate would then jump whichever pane happened to register
 * last, which is the sort of thing that looks like a rendering glitch rather
 * than a bug.
 *
 * So readers register per pane, and jumping asks for a path rather than
 * assuming there is only one place it could mean.
 */

export interface ReaderEntry {
	paneId: string;
	/** The PDF this reader is showing. */
	path: string;
	page: number;
	pages: number;
	navigate: (location: PdfLocation) => void;
}

/** By pane id: one reader per pane, at most. */
export type ReaderState = Record<string, ReaderEntry>;

/** What a mounted reader holds, so it can publish and let go without a race. */
export interface ReaderHandle {
	report(patch: Partial<Pick<ReaderEntry, 'page' | 'pages' | 'path'>>): void;
	release(): void;
}

function createReaderStore() {
	const { subscribe, set, update } = writable<ReaderState>({});

	// Identity per mount rather than per pane. Switching papers destroys one
	// reader and creates another in the same pane, and Svelte does not promise
	// which runs first: an unguarded release would delete the incoming reader's
	// entry and leave the pane unreachable until the tab was closed.
	const current = new Map<string, symbol>();

	// By path, not by pane: the point is that the place survives the reader.
	const positions = new Map<string, number>();

	// Jumps asked for before a reader existed to make them.
	const pending = new Map<string, PdfLocation>();

	return {
		subscribe,

		/** A reader, announcing itself. */
		register(entry: Omit<ReaderEntry, 'page' | 'pages'>): ReaderHandle {
			const token = Symbol('reader');
			current.set(entry.paneId, token);

			update((state) => ({
				...state,
				[entry.paneId]: { ...entry, page: 1, pages: 0 }
			}));

			return {
				report(patch) {
					if (current.get(entry.paneId) !== token) return;
					update((state) =>
						state[entry.paneId]
							? { ...state, [entry.paneId]: { ...state[entry.paneId], ...patch } }
							: state
					);
				},

				release() {
					if (current.get(entry.paneId) !== token) return;
					current.delete(entry.paneId);
					update((state) => {
						const next = { ...state };
						delete next[entry.paneId];
						return next;
					});
				}
			};
		},

		/**
		 * Show a place in a paper that is already open.
		 *
		 * False means no reader is showing that file, which is the caller's cue to
		 * open a tab first — this store does not open tabs, because deciding which
		 * pane a paper belongs in is `workspaceStore`'s business.
		 *
		 * `preferPane` breaks the tie when the same paper is open twice, so a jump
		 * lands in the pane the researcher is looking at rather than the other one.
		 */
		navigate(path: string, location: PdfLocation, preferPane?: string): boolean {
			const readers = Object.values(get({ subscribe }));

			const target =
				readers.find((r) => r.path === path && r.paneId === preferPane) ??
				readers.find((r) => r.path === path);

			if (!target) return false;

			target.navigate(location);
			return true;
		},

		/** Is this paper on screen anywhere? */
		isOpen(path: string): boolean {
			return Object.values(get({ subscribe })).some((r) => r.path === path);
		},

		/**
		 * Ask for a jump into a paper that is not open yet.
		 *
		 * Opening a tab and then jumping is a race: the reader has to exist, have
		 * its bytes, and have laid its pages out before it can scroll anywhere, and
		 * none of that has happened when `workspaceStore.open` returns. So the
		 * request is left here and the reader collects it when it is ready — the
		 * same request-and-take shape `documentsStore` uses to hand a manuscript to
		 * the editor.
		 */
		requestJump(path: string, location: PdfLocation) {
			pending.set(path, location);
		},

		/** The reader, collecting a jump left for it. Taken once. */
		takeJump(path: string): PdfLocation | null {
			const location = pending.get(path);
			if (!location) return null;

			// Consumed, so a later remount of the same paper opens where the reader
			// left off rather than replaying a jump from last week.
			pending.delete(path);
			return location;
		},

		/**
		 * Where the reader had got to in a paper.
		 *
		 * `Workspace` keys the reader on the tab's path, so every switch between
		 * two open papers destroys the reader and builds a new one — and the new
		 * one opens at page 1. Reading a forty-page paper and glancing at a second
		 * one used to cost the place in the first.
		 *
		 * In memory for now, so it survives a tab switch but not a restart.
		 * Surviving a restart wants the `reading_positions` table, which arrives
		 * with the rest of the annotation schema.
		 */
		remember(path: string, page: number) {
			positions.set(path, page);
		},

		recall(path: string): number | null {
			return positions.get(path) ?? null;
		},

		/** Tests, and closing a project. */
		reset() {
			current.clear();
			positions.clear();
			pending.clear();
			set({});
		}
	};
}

export const readerStore = createReaderStore();
