import type { Snapshot, Trigger } from '$lib/ipc/bindings';

/**
 * When the editor asks for a snapshot (M5-1 AC-2, ADR 007).
 *
 * Rust decides whether a request is a snapshot: while writing, not within ten
 * minutes of the last one, and never the bytes the newest already holds. This
 * decides when to ask, which is only once this session has written the
 * manuscript since its last snapshot. A document opened and closed unchanged
 * is already what its file says, and a file this build never wrote (one from
 * before 1.0, or one it couldn't read) isn't copied as if it were a snapshot.
 *
 * No Svelte and no Tauri: the call is passed in, so the rules are tested alone.
 */

export type Take = (
	path: string,
	trigger: Trigger,
	words: number | null
) => Promise<Snapshot | null>;

export interface Snapshots {
	/** A save of `path` has reached disk, holding `words`. */
	written(path: string, words: number | null): void;
	/**
	 * After a save: a snapshot if ten minutes have passed. Resolves once Rust
	 * has answered, so the next save can't land while the file is copied.
	 */
	writing(path: string): Promise<void>;
	/** The document is closing (or the app quitting): a snapshot if it changed. */
	closing(path: string, trigger: 'close' | 'quit'): Promise<void>;
	/** Whether `path` was written since its last snapshot. */
	pending(path: string): boolean;
}

/**
 * `onError` hears every failure, and `first` says whether it's the first for
 * that document: saves go on, and so do attempts, so a failure said on every
 * save would be said every ten minutes.
 */
export function createSnapshots(
	take: Take,
	onError: (path: string, error: unknown, first: boolean) => void = () => {}
): Snapshots {
	// Per path: the words at the last save, and which save that was. A save
	// landing while a snapshot is taken has a newer number, and stays pending.
	const unsaved = new Map<string, { words: number | null; save: number }>();
	let saves = 0;
	const failed = new Set<string>();

	async function ask(path: string, trigger: Trigger) {
		const written = unsaved.get(path);
		if (!written) return;
		try {
			const taken = await take(path, trigger, written.words);
			// While writing, "not yet" leaves it pending for the next save. A close
			// that took nothing found the newest snapshot already holding it.
			const done = taken !== null || trigger !== 'writing';
			if (done && unsaved.get(path)?.save === written.save) unsaved.delete(path);
		} catch (error) {
			onError(path, error, !failed.has(path));
			failed.add(path);
		}
	}

	return {
		written(path, words) {
			unsaved.set(path, { words, save: ++saves });
		},
		writing: (path) => ask(path, 'writing'),
		closing: (path, trigger) => ask(path, trigger),
		pending: (path) => unsaved.has(path)
	};
}
