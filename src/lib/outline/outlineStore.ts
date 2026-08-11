import { writable } from 'svelte/store';

import type { Heading } from './outline';

/**
 * The outline, and the way back into the document.
 *
 * The panel and the editor are siblings in the layout rather than parent and
 * child, so neither can reach the other directly. The editor publishes what it
 * has and hands over a way to jump; the panel reads and calls it.
 *
 * The navigate function lives here rather than being re-derived because only
 * the editor holds the view, and scrolling to a document position needs the
 * view, not the document.
 */

export interface OutlineState {
	headings: Heading[];
	/** Position of the heading whose section holds the cursor. */
	activePos: number | null;
	/** Provided by the editor while one is open. */
	navigate: ((pos: number) => void) | null;
}

const EMPTY: OutlineState = { headings: [], activePos: null, navigate: null };

function createOutlineStore() {
	const { subscribe, set, update } = writable<OutlineState>(EMPTY);

	return {
		subscribe,

		/** The editor, reporting what it has. */
		report(patch: Partial<OutlineState>) {
			update((state) => ({ ...state, ...patch }));
		},

		/**
		 * No document open.
		 *
		 * Clears `navigate` as well as the headings — a stale one would call into
		 * a destroyed editor view, and the panel outlives the editor when someone
		 * closes a project.
		 */
		clear() {
			set(EMPTY);
		}
	};
}

export const outlineStore = createOutlineStore();
