import { Selection, TextSelection } from '@tiptap/pm/state';
import { get, writable } from 'svelte/store';

/**
 * Citing from where the manuscript isn't (M1b-8).
 *
 * The Sources view takes the editor's place, and a paper in front of the
 * manuscript's tab does too, so the editor is unmounted while someone reads a
 * source's notes. **Cite with p. 78** there asks for a citation here; the
 * editor takes it when it's back, and puts it where the writer left off.
 */

/** A citation waiting for the editor: the work, and the page cited, as printed. */
export interface WaitingCite {
	id: string;
	locator: string | null;
}

/**
 * How long a citation waits. Leaving the Sources view mounts the editor at
 * once; one that never got there (it failed to open) mustn't put the
 * citation in, unasked, the next time a manuscript opens, maybe another one.
 */
export const WAIT_MS = 15_000;

function createWaitingCite(now: () => number = Date.now) {
	const store = writable<(WaitingCite & { at: number }) | null>(null);

	return {
		subscribe: store.subscribe,

		/** Ask for a citation. A second ask before the editor is back replaces the first. */
		request(cite: WaitingCite) {
			store.set({ ...cite, at: now() });
		},

		/** The citation asked for, once: taking it clears it. Null once it's waited too long. */
		take(): WaitingCite | null {
			const cite = get(store);
			if (!cite) return null;
			store.set(null);
			if (now() - cite.at > WAIT_MS) return null;
			return { id: cite.id, locator: cite.locator };
		}
	};
}

/** For tests, with a clock of their own. */
export const createWaitingCiteForTest = createWaitingCite;

export const waitingCite = createWaitingCite();

/**
 * Where the cursor was in each manuscript, by path, while the app is open.
 *
 * The editor is built afresh each time it's shown, and used to open at the
 * end. Coming back from a paper or the Sources view put the cursor somewhere
 * the writer never left it, and a citation asked for there went in at the end
 * of the chapter.
 */
function createCursorMemory() {
	const positions = new Map<string, number>();

	return {
		remember(path: string, position: number) {
			positions.set(path, position);
		},

		recall(path: string | undefined): number | undefined {
			return path === undefined ? undefined : positions.get(path);
		},

		/** For tests: a new session remembers nothing. */
		reset() {
			positions.clear();
		}
	};
}

export const cursorMemory = createCursorMemory();

/**
 * Where a selection's cursor is, as a place text can go: a picked image or
 * page break has its head between blocks, and a citation put there would
 * open a paragraph of its own.
 */
export function cursorPosition(selection: Selection): number {
	if (selection instanceof TextSelection) return selection.head;
	return Selection.near(selection.$head).head;
}
