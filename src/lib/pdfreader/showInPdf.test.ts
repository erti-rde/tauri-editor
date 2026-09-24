import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

import { readerStore } from './readerStore';
import { showInPdf } from './showInPdf';
import { workspaceStore } from '$lib/workspace/workspaceStore';
import { pathForSource } from '$lib/stores/db';
import { errorToast } from '$lib/toast/Toast.svelte';

/**
 * The way back from a citation to the page it came from (#37).
 *
 * Two cases matter and they are not the same: the paper is already on screen,
 * or it is not. The second is a race — a tab opened now has no reader, no bytes
 * and no laid-out pages to scroll to — so it is the one worth pinning down.
 */

vi.mock('$lib/stores/db', () => ({ pathForSource: vi.fn() }));
vi.mock('$lib/toast/Toast.svelte', () => ({ errorToast: vi.fn() }));

const PATH = '/papers/smith-2020.pdf';

beforeEach(() => {
	vi.clearAllMocks();
	readerStore.reset();
	workspaceStore.reset();
	vi.mocked(pathForSource).mockResolvedValue(PATH);
});

describe('when the paper is already open', () => {
	it('jumps in place rather than opening it again', async () => {
		const navigate = vi.fn();
		readerStore.register({ paneId: 'pane-1', path: PATH, navigate });

		const shown = await showInPdf({ sha256: 'abc123', page: 4 });

		expect(shown).toBe(true);
		expect(navigate).toHaveBeenCalledWith({ page: 4 });
		expect(Object.keys(get(workspaceStore).tabs)).toHaveLength(0);
	});

	it('carries the quote through, so the passage is marked and not just the page', async () => {
		const navigate = vi.fn();
		readerStore.register({ paneId: 'pane-1', path: PATH, navigate });

		await showInPdf({ sha256: 'abc123', page: 4, selector: { quote: 'the effect held' } });

		expect(navigate).toHaveBeenCalledWith({
			page: 4,
			selector: { quote: 'the effect held' }
		});
	});
});

describe('when the paper is not open', () => {
	it('opens a tab for it', async () => {
		const shown = await showInPdf({ sha256: 'abc123', page: 4 });

		expect(shown).toBe(true);
		expect(get(workspaceStore).tabs[PATH]).toMatchObject({
			kind: 'pdf',
			title: 'smith-2020.pdf'
		});
	});

	it('leaves the jump for the reader to collect when it is ready', async () => {
		// The reader cannot scroll before pdf.js has laid out its pages, so the
		// jump cannot be made at the moment the tab is opened.
		await showInPdf({ sha256: 'abc123', page: 4 });

		expect(readerStore.takeJump(PATH)).toEqual({ page: 4 });
	});

	it('hands the jump over only once', async () => {
		// Otherwise reopening the paper next week replays a jump from a citation
		// followed long ago, instead of returning to where reading stopped.
		await showInPdf({ sha256: 'abc123', page: 4 });

		expect(readerStore.takeJump(PATH)).not.toBeNull();
		expect(readerStore.takeJump(PATH)).toBeNull();
	});
});

describe('when the file has moved', () => {
	it('says so instead of doing nothing', async () => {
		// The library records where a hash has been seen, not a file it owns, so
		// this is an ordinary outcome rather than a broken state.
		vi.mocked(pathForSource).mockResolvedValue(null);

		const shown = await showInPdf({ sha256: 'abc123', page: 4 });

		expect(shown).toBe(false);
		expect(errorToast).toHaveBeenCalledWith(expect.stringContaining('not where Erti last saw it'));
	});

	it('says so for a source the project does not have at all', async () => {
		vi.mocked(pathForSource).mockResolvedValue(null);

		expect(await showInPdf({ sha256: 'missing', page: 1 })).toBe(false);
		expect(errorToast).toHaveBeenCalled();
	});

	it('does not throw when the lookup itself fails', async () => {
		vi.mocked(pathForSource).mockRejectedValue(new Error('library is not open'));

		expect(await showInPdf({ sha256: 'abc123', page: 1 })).toBe(false);
		expect(errorToast).toHaveBeenCalled();
	});
});
