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
 * overlap, a failure keeps the content and retries it, and `flush` does not
 * resolve until everything outstanding has actually been written.
 */

export type SaveState = 'idle' | 'pending' | 'saving' | 'error';

export interface AutosaveOptions {
	/** Persist the content. Rejecting marks the save failed and keeps it pending. */
	write: (content: unknown) => Promise<void>;
	/** Quiet period before a save, in milliseconds. */
	delay?: number;
	/** First wait before retrying a failed write. Doubles, up to `maxRetryDelay`. */
	retryDelay?: number;
	maxRetryDelay?: number;
	onStateChange?: (state: SaveState) => void;
	onError?: (error: unknown) => void;
}

export interface Autosave {
	/** Record an edit. The content is read when the save actually runs. */
	schedule: (getContent: () => unknown) => void;
	/**
	 * Write everything outstanding and wait for it.
	 *
	 * Resolves only once no write is in flight and nothing is pending, so it can
	 * be awaited before closing a document. Returns false if it gave up because
	 * a write failed, leaving the content pending for the next attempt.
	 */
	flush: () => Promise<boolean>;
	/** Stop all timers. Does not write — call `flush` first if that matters. */
	destroy: () => void;
	/** Whether anything is waiting to be written, or is being written now. */
	readonly hasUnsavedChanges: boolean;
	readonly state: SaveState;
}

export function createAutosave({
	write,
	delay = 500,
	retryDelay = 2000,
	maxRetryDelay = 30_000,
	onStateChange,
	onError
}: AutosaveOptions): Autosave {
	// The *getter*, not the content: reading late means one write per quiet
	// period rather than one per keystroke, and always the newest document.
	let pending: (() => unknown) | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let nextRetry = retryDelay;
	let state: SaveState = 'idle';

	// The run in progress. Held rather than a boolean flag so that a caller
	// arriving mid-write can await the same work instead of being told to go
	// away — which is what let `flush` resolve while a write was still running.
	let active: Promise<void> | null = null;

	function moveTo(next: SaveState) {
		if (state === next) return;
		state = next;
		onStateChange?.(next);
	}

	function drain(): Promise<void> {
		if (active) return active;
		if (!pending) return Promise.resolve();

		active = run().finally(() => {
			active = null;
		});
		return active;
	}

	async function run(): Promise<void> {
		moveTo('saving');

		// Loop rather than write once: edits landing while the await is
		// outstanding set `pending` again, and picking them up here is what stops
		// them being dropped.
		while (pending) {
			const getContent = pending;
			pending = null;

			try {
				await write(getContent());
			} catch (error) {
				// Keep the content — a failed write must not be a lost edit. Only if
				// nothing newer arrived while this write was outstanding, though:
				// putting the failed getter back unconditionally would overwrite a
				// newer edit with older content, which is the very loss this exists
				// to prevent.
				if (!pending) pending = getContent;

				moveTo('error');
				onError?.(error);
				scheduleRetry();
				return;
			}
		}

		nextRetry = retryDelay;
		moveTo('idle');
	}

	function scheduleRetry() {
		clearTimeout(retryTimer);
		retryTimer = setTimeout(() => {
			void drain();
		}, nextRetry);
		// Backing off keeps a persistently unwritable disk from being hammered,
		// while a transient failure still recovers quickly.
		nextRetry = Math.min(nextRetry * 2, maxRetryDelay);
	}

	return {
		schedule(getContent: () => unknown) {
			pending = getContent;
			if (state !== 'saving') moveTo('pending');

			// An edit is also the moment to retry a failed save.
			clearTimeout(retryTimer);
			nextRetry = retryDelay;

			clearTimeout(timer);
			timer = setTimeout(() => {
				void drain();
			}, delay);
		},

		async flush(): Promise<boolean> {
			clearTimeout(timer);
			clearTimeout(retryTimer);

			// Keep going until nothing is outstanding: a write in flight is awaited,
			// and anything scheduled during it is written by the next pass.
			//
			// The pass limit is a backstop, not the mechanism. It holds only if
			// `drain` stops making progress — awaiting something already settled, or
			// returning while a write is still running — and closing a document is
			// not worth hanging the app over if that ever becomes true.
			for (let pass = 0; pass < 100; pass++) {
				if (!active && !pending) return true;

				await drain();
				if (state === 'error') return false;
			}

			return !pending && !active;
		},

		destroy() {
			clearTimeout(timer);
			clearTimeout(retryTimer);
		},

		get hasUnsavedChanges() {
			// A write in flight counts: the content is not on disk yet, and the
			// window-close path reads this to decide whether to wait.
			return pending !== null || active !== null;
		},

		get state() {
			return state;
		}
	};
}
