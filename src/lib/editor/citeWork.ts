import type { Editor } from '@tiptap/core';

import { citationStore } from '$lib/stores/citationStore';
import { addToProject } from '$lib/stores/db';
import { errorToast } from '$lib/toast/Toast.svelte';
import { log } from '$lib/log';

/**
 * Cite a work at the cursor, from a note, a mark or a passage (M1b-8, M3-2).
 *
 * `id` may be any of the work's ids: it's cited as its canonical one (ADR 003).
 * A work the project hasn't got yet joins it first (M3-2 AC-2), since a
 * citation the project can't render is no use to anyone. `locator` is the page,
 * as the paper prints it when that's known, else the sheet.
 */
export async function citeWork(editor: Editor, id: string, locator?: string) {
	const sha256 = citationStore.canonicalId(id);
	try {
		if (!citationStore.getAllSourcesAsJson()[sha256]) {
			await addToProject(sha256);
			await citationStore.initializeCitationStore();
		}

		if (!citationStore.getAllSourcesAsJson()[sha256]) {
			errorToast(
				'That paper has no citation details yet, so it cannot be cited. It has been added to this project — open the metadata explorer to paste a DOI or enter the details.'
			);
			return;
		}

		// The page goes with the work (M1b-8), trimmed as the render and the
		// LaTeX export read it.
		const page = locator?.trim();
		const locators = page ? { [sha256]: page } : null;
		editor.commands.insertCitation({
			id: JSON.stringify([sha256]),
			label: citationStore.previewCitation([sha256], locators ?? {}),
			locators
		});
	} catch (failure) {
		log.error('Could not cite that paper', failure);
		errorToast('Could not cite that paper.');
	}
}
