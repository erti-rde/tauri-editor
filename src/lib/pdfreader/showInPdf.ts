import { get } from 'svelte/store';

import { pathForSource } from '$lib/stores/db';
import { errorToast } from '$lib/toast/Toast.svelte';
import { workspaceStore } from '$lib/workspace/workspaceStore';

import { readerStore } from './readerStore';

import type { PdfLocation } from './location';

/**
 * Show a passage in the paper it came from.
 *
 * This is the way back that the reading side never had. A search result could
 * say "p. 4, Results" and the researcher had to find page 4 themselves, which
 * is issue #37 and is also the thing that makes a quotation checkable at all.
 *
 * Written here rather than in the card that first needed it, because every
 * later surface wants exactly this: a highlight in the notes panel, a note
 * beside the cursor while drafting, a citation in the manuscript.
 */

/** Whatever a chunk or an annotation knows about where it came from. */
export interface SourceLocation extends PdfLocation {
	sha256: string;
}

function fileName(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
}

export async function showInPdf(target: SourceLocation): Promise<boolean> {
	const { sha256, ...location } = target;

	let path: string | null = null;
	try {
		// Asked of the library rather than the project's own source set, because
		// a note can be about a paper read for something else entirely — which is
		// the case content-addressing exists to serve.
		path = await pathForSource(sha256);
	} catch (failure) {
		console.error('Could not look up the source:', failure);
	}

	if (!path) {
		// The library records where a hash has been seen, not a file it owns, so a
		// paper that has been moved or deleted still cites correctly and only this
		// degrades. Saying so is better than a jump that quietly does nothing.
		errorToast('That paper is not where Erti last saw it, so it cannot be opened.');
		return false;
	}

	// Already on screen: jump in place, preferring the pane being looked at so
	// the same paper open in both does not scroll the one behind you.
	const focused = get(workspaceStore).focused;
	if (readerStore.navigate(path, location, focused)) return true;

	// Not open yet. The reader cannot scroll before it has laid out its pages,
	// so the jump is left for it to collect rather than raced against.
	readerStore.requestJump(path, location);
	workspaceStore.open({ id: path, kind: 'pdf', title: fileName(path) });

	return true;
}
