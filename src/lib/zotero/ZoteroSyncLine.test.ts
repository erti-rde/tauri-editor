import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

import { useFakeBackend } from '$lib/harness/testing';
import { call, commands } from '$lib/ipc';
import { augmentSchema } from '$lib/metadata-explorer/adapterCslZotero';
import ZoteroSyncLine from './ZoteroSyncLine.svelte';

/**
 * The Sources line for a project in step with Zotero (M1b-11 AC-8), on the
 * fake backend: it says what's new, syncs when asked, and removes nothing.
 */

const WORK = 'erti:00000000-0000-4000-8000-000000000001';

describe('ZoteroSyncLine', () => {
	const backend = useFakeBackend();

	/** A project following Thesis, which has Ostrom already, without its PDF. */
	async function following() {
		const state = backend().state;
		state.libraryOpen = true;
		state.root = '/fake/project';
		state.zotero.linked = state.zotero.detected;
		state.zotero.follow = [
			{ library: 'user', kind: 'collection', key: 'THESIS22', name: 'Thesis' }
		];
		await call(
			commands.importSources(
				[
					{
						id: WORK,
						csl_json: JSON.stringify({ type: 'book', title: 'Governing the Commons' }),
						zotero_type: 'book'
					}
				],
				true
			)
		);
		state.zotero.imported = { 'user/PAPERBB3': WORK };
		return { schema: await augmentSchema() };
	}

	it('M1b-11 AC-8: says what is new, and Sync brings it in and its PDFs, once', async () => {
		const { schema } = await following();
		const onimported = vi.fn();
		const user = userEvent.setup();
		render(ZoteroSyncLine, { props: { schema, onimported } });

		// Chapter 2's paper is new, and Ostrom's PDF isn't attached yet.
		const line = await screen.findByTestId('zotero-sync');
		await waitFor(() => expect(line).toHaveTextContent('Following Thesis in Zotero · 2 new'));

		await user.click(screen.getByRole('button', { name: 'Sync' }));
		await waitFor(() => expect(onimported).toHaveBeenCalled());
		const [imported, gone] = onimported.mock.calls[0];
		expect(imported.added).toHaveLength(1);
		expect(imported.attached.map((a: { path: string }) => a.path).sort()).toEqual([
			'/fake/home/Zotero/storage/ATTACHB3/ostrom-1990.pdf',
			'/fake/home/Zotero/storage/ATTACHC4/fukuyama-1995.pdf'
		]);
		expect(gone).toBe(0);
		await waitFor(() => expect(line).toHaveTextContent('nothing new'));
		expect(screen.queryByRole('button', { name: 'Sync' })).not.toBeInTheDocument();

		// Nothing the project had is gone from it.
		expect(backend().state.project.has(WORK)).toBe(true);
	});

	it('M1b-11 AC-8: a paper added in Zotero later shows as new', async () => {
		const { schema } = await following();
		const state = backend().state;
		const { rerender } = render(ZoteroSyncLine, {
			props: { schema, onimported: vi.fn(), revision: 0 }
		});
		const line = await screen.findByTestId('zotero-sync');
		await waitFor(() => expect(line).toHaveTextContent('2 new'));

		state.zotero.papers.push({
			library: 'user',
			key: 'NEWPAPR2',
			item_type: 'book',
			fields: [{ name: 'title', base: null, value: 'Added later' }],
			creators: [],
			pdfs: [],
			in: ['CHAPTER2']
		});
		await rerender({ schema, onimported: vi.fn(), revision: 1 });
		await waitFor(() => expect(line).toHaveTextContent('3 new'));
	});

	it('M1b-11 AC-8: a first check that fails says so, and can be tried again', async () => {
		backend().state.libraryOpen = true;
		backend().state.root = '/fake/project';
		const failing = vi.spyOn(commands, 'zoteroFollowing').mockResolvedValueOnce({
			status: 'error',
			error: { kind: 'Database', message: 'The project can’t be read.' }
		} as never);
		const user = userEvent.setup();
		render(ZoteroSyncLine, { props: { schema: await augmentSchema(), onimported: vi.fn() } });

		const line = await screen.findByTestId('zotero-sync');
		expect(line).toHaveTextContent(/^Zotero · couldn’t check: .*The project can’t be read\./);
		await user.click(screen.getByRole('button', { name: 'Check again' }));
		// It follows nothing, so once it's asked there's nothing to say.
		await waitFor(() => expect(screen.queryByTestId('zotero-sync')).not.toBeInTheDocument());
		failing.mockRestore();
	});

	it('shows nothing for a project that follows nothing', async () => {
		backend().state.libraryOpen = true;
		backend().state.root = '/fake/project';
		render(ZoteroSyncLine, { props: { schema: await augmentSchema(), onimported: vi.fn() } });
		await waitFor(() =>
			expect(backend().calls.some((c) => c.cmd === 'zotero_following')).toBe(true)
		);
		expect(screen.queryByTestId('zotero-sync')).not.toBeInTheDocument();
	});
});
