import { open } from '@tauri-apps/plugin-dialog';

import { describeError } from '$lib/ipc';
import { attachFile } from '$lib/stores/db';
import { errorToast, successToast } from '$lib/toast/Toast.svelte';
import { retryIngest } from '$utils/pdf_handlers';

/**
 * Attach a PDF to a source (M1b-7, docs/ux.md UX-2 and UX-3): pick it, record
 * it as the source's file, then read it as a folder scan would.
 *
 * `onchange` runs once the file is recorded, so the row shows it pending, and
 * again once it's read, so the row follows it to ready or failed. Returns
 * whether a file was attached; a cancelled picker isn't a failure.
 */
export async function attachPdf(
	work: string,
	onchange: () => void | Promise<void>
): Promise<boolean> {
	const path = await open({
		title: 'Attach a PDF',
		multiple: false,
		directory: false,
		filters: [{ name: 'PDF', extensions: ['pdf'] }]
	});
	if (typeof path !== 'string') return false;

	let attached;
	try {
		attached = await attachFile(work, path);
	} catch (error) {
		errorToast(`Could not attach it: ${describeError(error)}`);
		return false;
	}

	// A PDF already in the library as a source of its own is now this one,
	// and so are its citations. Said, because it changes what they render as.
	if (attached.merged) {
		successToast(
			`${attached.file_name} was “${attached.merged}” in your library. It’s now this source’s file, and its citations show this source.`
		);
	} else if (!attached.needs_ingest) {
		successToast(`Attached ${attached.file_name}.`);
	}
	await onchange();

	if (attached.needs_ingest) {
		try {
			// Under the file's own hash, as a scan reads it: its chunks and the
			// details it resolves to stay off the work (ADR 003).
			await retryIngest({ sha256: attached.sha256, path, file_name: attached.file_name });
		} catch {
			// Recorded against the file and said by ingest; the row shows it,
			// with Retry, once it's listed again.
		}
		await onchange();
	}
	return true;
}
