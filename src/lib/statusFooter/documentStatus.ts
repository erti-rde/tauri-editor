import { writable } from 'svelte/store';

import type { SaveState } from '$lib/editor/autosave';
import type { WordCount } from '$lib/editor/wordCount';

/**
 * What the status bar shows about the open manuscript.
 *
 * A store rather than props, because the bar sits outside the editor in the app
 * shell and threading this through every layer between them would couple three
 * components that otherwise have nothing to say to each other.
 *
 * The counts belong here rather than above the toolbar: a status bar is where
 * an editor puts the things you glance at, and putting them there gives the
 * writing back the vertical space.
 */

export interface DocumentStatus {
	words: WordCount | null;
	/** The word target from Settings, or 0 when none is set. */
	target: number;
	save: SaveState;
}

const EMPTY: DocumentStatus = { words: null, target: 0, save: 'idle' };

function createDocumentStatus() {
	const { subscribe, set, update } = writable<DocumentStatus>(EMPTY);

	return {
		subscribe,
		report: (patch: Partial<DocumentStatus>) => update((s) => ({ ...s, ...patch })),
		/** Cleared when no manuscript is open, so the bar does not show a stale count. */
		clear: () => set(EMPTY)
	};
}

export const documentStatus = createDocumentStatus();
