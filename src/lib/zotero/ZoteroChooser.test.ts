import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

import { useFakeBackend } from '$lib/harness/testing';
import type { ZoteroPick } from '$lib/ipc';
import ZoteroChooser from './ZoteroChooser.svelte';

// Erti's own Zotero → CSL maps, missing.
vi.mock('$lib/metadata-explorer/adapterCslZotero', async (original) => ({
	...(await original<typeof import('$lib/metadata-explorer/adapterCslZotero')>()),
	zoteroCslMaps: vi.fn(async () => {
		throw new Error('Erti’s list of Zotero fields is missing.');
	})
}));

/** The chooser (M1b-11 AC-5) when there's nothing to read what's ticked with. */
describe('ZoteroChooser', () => {
	const backend = useFakeBackend();

	it('M1b-11 AC-5: says why nothing can be read, and keeps saying it as ticks change', async () => {
		backend().state.libraryOpen = true;
		const thesis: ZoteroPick = { library: 'user', kind: 'collection', key: 'THESIS22', name: null };
		const { rerender } = render(ZoteroChooser, { props: { picks: [] } });
		expect(await screen.findByText(/list of Zotero fields is missing/)).toBeVisible();

		await rerender({ picks: [thesis] });
		expect(screen.getByText(/list of Zotero fields is missing/)).toBeVisible();
	});
});
