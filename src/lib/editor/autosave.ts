/**
 * Saving the manuscript without losing keystrokes.
 *
 * The editor previously did this on every update:
 *
 *     clearTimeout(saveTimeout);
 *     if (isSaving) return;
 *     saveTimeout = setTimeout(save, 500);
 *
 * which cancels the pending save and then schedules nothing in its place. Type
 * while a write is in flight and those edits are dropped; stop typing there and
 * they are never written at all. Silent, and worst on a slow disk or a large
 * document — the cases where a researcher can least afford it.
 *
 * The rule here is that the most recent content always reaches disk. Edits
 * arriving during a write are kept and written when it finishes, writes never
 * overlap, and a failure keeps the content pending rather than discarding it.
 */

export type SaveState = 'idle' | 'pending' | 'saving' | 'error';

export interface AutosaveOptions {
	/** Persist the content. Rejecting marks the save failed and keeps it pending. */
	write: (content: unknown) => Promise<void>;
	/** Quiet period before a save, in milliseconds. */
	delay?: number;
	onStateChange?: (state: SaveState) => void;
	onError?: (error: unknown) => void;
}

export interface Autosave {
	/** Record an edit. The content is read when the save actually runs. */
	schedule: (getContent: () => unknown) => void;
	/** Write any outstanding content now. Await before closing a document. */
	flush: () => Promise<void>;
	/** Stop the timer. Does not write — call `flush` first if that matters. */
	destroy: () => void;
	/** Whether anything is waiting to be written. */
	readonly hasUnsavedChanges: boolean;
	readonly state: SaveState;
}

export function createAutosave({
	write,
	delay = 500,
	onStateChange,
	onError
}: AutosaveOptions): Autosave {
	// The *getter*, not the content: reading late means one write per quiet
	// period rather than one per keystroke, and always the newest document.
	let pending: (() => unknown) | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let writing = false;
	let state: SaveState = 'idle';

	function moveTo(next: SaveState) {
		if (state === next) return;
		state = next;
		onStateChange?.(next);
	}

	async function drain(): Promise<void> {
		// A write is already running; it will pick up whatever arrived, so a
		// second pass here would only duplicate it.
		if (writing) return;
		if (!pending) return;

		writing = true;
		moveTo('saving');

		try {
			// Loop rather than write once: edits that land while the await is
			// outstanding set `pending` again, and this is what stops them being
			// dropped, which was the whole defect.
			while (pending) {
				const getContent = pending;
				pending = null;

				try {
					await write(getContent());
				} catch (error) {
					// Keep the content. A failed write must not be a lost edit, and
					// the next edit or flush will try again.
					pending = getContent;
					moveTo('error');
					onError?.(error);
					return;
				}
			}
			moveTo('idle');
		} finally {
			writing = false;
		}
	}

	return {
		schedule(getContent: () => unknown) {
			pending = getContent;
			if (state !== 'saving') moveTo('pending');

			clearTimeout(timer);
			timer = setTimeout(() => {
				void drain();
			}, delay);
		},

		async flush() {
			clearTimeout(timer);
			await drain();

			// A write that was already running when flush was called takes the
			// content with it, but anything scheduled *during* that write is still
			// outstanding when it returns. One more pass settles it.
			if (pending) await drain();
		},

		destroy() {
			clearTimeout(timer);
		},

		get hasUnsavedChanges() {
			return pending !== null;
		},

		get state() {
			return state;
		}
	};
}
