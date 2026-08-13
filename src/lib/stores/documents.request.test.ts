import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

import { documentsStore, requested } from './documents.svelte';
import type { ProjectDocument } from '$lib/editor/documents';

/**
 * Asking for a manuscript, from somewhere that cannot open one.
 *
 * The file tree and the tab strip know which document was clicked. Opening one
 * means saving the outgoing manuscript, reading the new file and replacing the
 * editor's content — all of which needs the editor. They leave a request.
 *
 * The distinction this pins is why clicking a manuscript in the tree showed
 * nothing: setting `current` directly makes the editor's own guard — "already
 * current, nothing to do" — true before any content has been read, so the old
 * manuscript stays on screen under the new one's name.
 */

const doc = (name: string): ProjectDocument => ({
	path: `/p/${name}.erti.json`,
	fileName: `${name}.erti.json`,
	title: name,
	legacy: false
});

beforeEach(() => {
	documentsStore.reset();
	requested.set(null);
});

describe('requesting a document', () => {
	it('publishes the request without switching the current one', () => {
		documentsStore.request(doc('chapter-2'));

		expect(get(requested)?.title).toBe('chapter-2');
		// Crucially still null: the editor has not opened it yet, and claiming
		// otherwise is what made the guard skip the load.
		expect(get(documentsStore).current).toBeNull();
	});

	it('is cleared once taken, so it is performed once', () => {
		documentsStore.request(doc('chapter-2'));

		documentsStore.taken();

		expect(get(requested)).toBeNull();
	});

	it('replaces an untaken request rather than queueing it', () => {
		// Two quick clicks should open the second document, not both in turn.
		documentsStore.request(doc('chapter-2'));
		documentsStore.request(doc('chapter-3'));

		expect(get(requested)?.title).toBe('chapter-3');
	});

	it('leaves `open` as the thing that actually switches', () => {
		documentsStore.open(doc('chapter-2'));

		expect(get(documentsStore).current?.title).toBe('chapter-2');
		expect(get(requested)).toBeNull();
	});
});
