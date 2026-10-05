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

function createWaitingCite() {
	const store = writable<WaitingCite | null>(null);

	return {
		subscribe: store.subscribe,

		/** Ask for a citation. A second ask before the editor is back replaces the first. */
		request(cite: WaitingCite) {
			store.set(cite);
		},

		/** The citation asked for, once: taking it clears it. */
		take(): WaitingCite | null {
			const cite = get(store);
			if (cite) store.set(null);
			return cite;
		}
	};
}

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
