import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import Result from './Result.svelte';
import * as db from '$lib/stores/db';
import { citationStore } from '$lib/stores/citationStore';
import { defaultFixture, ROOT, SHA } from '$lib/harness/fixture';
import { useFakeBackend } from '$lib/harness/testing';
import { showInPdf } from '$lib/pdfreader/showInPdf';

vi.mock('$lib/pdfreader/showInPdf', () => ({ showInPdf: vi.fn(async () => true) }));

// The panel slides in with a Svelte transition, which jsdom can't animate.
Element.prototype.animate ??= vi.fn(() => ({
	cancel() {},
	finished: Promise.resolve(),
	onfinish: null
})) as unknown as Element['animate'];

const BOOK = 'erti:6f1c3a52-8d0e-4c1b-9a7e-2b5d4f3e1a01';

/**
 * A book cited with no file, then the PDF of it found by a folder scan and
 * attached (ADR 003). The scan put the PDF's own hash in the project.
 */
const backend = useFakeBackend(() => {
	const world = defaultFixture();
	world.sources.push({
		sha256: BOOK,
		file_name: '',
		path: null,
		csl_json: JSON.stringify({
			id: BOOK,
			type: 'book',
			title: 'Attention, the Book',
			author: [{ family: 'Tanaka', given: 'Yui' }],
			issued: { 'date-parts': [[2021]] }
		}),
		zotero_type: 'book',
		doi: null,
		resolved_via: 'manual',
		state: 'ready',
		last_error: null
	});
	world.aliases = { [SHA.devlin]: BOOK };
	return world;
});

// M1b-3 AC-1: search results
describe('a passage from a PDF attached to a work', () => {
	it('is described and cited as the work, and opens the PDF', async () => {
		const user = userEvent.setup();
		await db.openLibrary('/fake/home/Erti/library.db');
		await db.openProject(ROOT);
		// A work with no file has no passages; its PDF has this one.
		backend().state.chunks.delete(BOOK);
		backend().state.chunks.set(SHA.devlin, [
			{ text: 'masked language model pre-training', embedding: [], page_start: 4 }
		]);
		await citationStore.initializeCitationStore();
		const selectCitation = vi.fn();

		render(Result, {
			selectedText: 'masked language model',
			closePanel: () => {},
			selectCitation
		});

		// The work's own metadata, not the PDF's (CSL on an alias is ignored).
		expect(await screen.findAllByText('Attention, the Book')).not.toHaveLength(0);
		expect(screen.queryByText(/BERT/)).not.toBeInTheDocument();

		// The best match comes first; the fake scores the rest of the project 0.
		await user.click(screen.getAllByRole('button', { name: /^Cite$/ })[0]);
		expect(selectCitation).toHaveBeenCalledWith(
			expect.objectContaining({ id: JSON.stringify([BOOK]) })
		);

		await user.click(screen.getAllByRole('button', { name: /Show in PDF/ })[0]);
		expect(showInPdf).toHaveBeenCalledWith(
			expect.objectContaining({ sha256: SHA.devlin, page: 4 })
		);
	});
});
