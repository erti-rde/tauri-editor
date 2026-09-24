import { listen } from '@tauri-apps/api/event';

import { errorToast } from '$lib/toast/Toast.svelte';

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
