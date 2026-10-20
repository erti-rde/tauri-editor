import { listen } from '@tauri-apps/api/event';

import { commands, describeError, run } from '$lib/ipc';
import { log } from '$lib/log';
import { errorToast, toast } from '$lib/ui/Toast.svelte';

/**
 * Say once when a library backup fails (ADR 008, M1a-5 AC-5).
 *
 * Rust backs the library up while opening it, and the daily copy finishes in
 * the background after the command has returned, so a failure arrives as an
 * event. Once per session: the pre-migration and daily copies can both fail for
 * the same reason (a full disk), and one warning is the useful one.
 *
 * Call before `openLibrary`, or a failure before the upgrade goes unheard.
 */
export function watchBackups(show: (message: string) => void = errorToast) {
	let said = false;
	return listen<string>('library-backup-failed', ({ payload }) => {
		if (said) return;
		said = true;
		show(
			`Erti couldn't back up your library (${payload}). It opened as normal and will try again next time.`
		);
	});
}

const RESTORED = 'erti:library-restored';

const savers = new Set<() => Promise<boolean>>();

/**
 * Something to write before the window starts again: the open manuscript.
 * Returns the way to stop.
 */
export function saveBeforeReopen(save: () => Promise<boolean>): () => void {
	savers.add(save);
	return () => savers.delete(save);
}

/** Write everything that asked to be, saying whether all of it was. */
export async function savedForReopen(): Promise<boolean> {
	const saved = await Promise.all([...savers].map((save) => save().catch(() => false)));
	return saved.every(Boolean);
}

/**
 * Start the window again after a restore (M5-10 AC-2).
 *
 * Rust has the restored library open by now, but every store here still holds
 * rows from the one it replaced: sources, marks, notes, labels. Starting again
 * reads them all afresh, as a launch does. What was restored is kept across
 * the reload, so the window can say so when it's back.
 */
export function reopenAfterRestore(replaced: string, reload = () => window.location.reload()) {
	try {
		sessionStorage.setItem(RESTORED, replaced);
	} catch {
		// Said or not, the library is restored.
	}
	reload();
}

/** Say, once, that the library was restored before the window started again. */
export function sayIfRestored() {
	let replaced: string | null = null;
	try {
		replaced = sessionStorage.getItem(RESTORED);
		sessionStorage.removeItem(RESTORED);
	} catch {
		return;
	}
	if (!replaced) return;
	toast({
		kind: 'success',
		title: 'Restored your library from a backup',
		description: `The library it replaced is kept in the backup folder as ${replaced}.`,
		action: { label: 'Open backup folder', run: () => void openBackupFolder() }
	});
}

export async function openBackupFolder() {
	try {
		await run(commands.openBackupFolder());
	} catch (error) {
		log.error('Could not open the backup folder', error);
		errorToast(describeError(error));
	}
}
