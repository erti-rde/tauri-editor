import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { get, writable } from 'svelte/store';

const { db, toast, annotations } = vi.hoisted(() => ({
	db: {
		sourceAliases: vi.fn(async () => ({})),
		sourceRemoval: vi.fn(),
		removeSource: vi.fn(async () => {})
	},
	toast: { errorToast: vi.fn(), successToast: vi.fn() },
	annotations: {
		dropIf: vi.fn((_gone: (path: string) => boolean) => false),
		openPath: vi.fn(async (_path: string) => {})
	}
}));

vi.mock('$lib/stores/db', () => db);
vi.mock('$lib/toast/Toast.svelte', () => toast);
vi.mock('$lib/stores/annotations.svelte', () => ({ annotationsStore: annotations }));
vi.mock('$lib/stores/fileSystem.svelte', () => ({
	fileSystemStore: writable({ items: [], currentPath: '/thesis' })
}));

import { readerStore } from '$lib/pdfreader/readerStore';
import { workspaceStore } from '$lib/workspace/workspaceStore';

import RemoveSource from './RemoveSource.svelte';

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	workspaceStore.reset();
});

const counts = { notes: 0, highlights: 1, paths: [] };

describe('RemoveSource (M1b-4)', () => {
	it('removes the source it counted, though another row was chosen meanwhile', async () => {
		let answer: (value: typeof counts) => void = () => {};
		db.sourceRemoval.mockReturnValue(new Promise((resolve) => (answer = resolve)));
		const onremoved = vi.fn();
		const view = render(RemoveSource, {
			props: { id: 'a', title: 'Paper A', csl: null, onremoved }
		});

		await fireEvent.click(view.getByRole('button', { name: 'Remove from library…' }));
		// The rows stay clickable while every manuscript is read.
		await view.rerender({ id: 'b', title: 'Paper B', csl: null, onremoved });
		answer(counts);

		const dialog = await view.findByRole('dialog', { name: 'Remove “Paper A” from your library?' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
		await waitFor(() => expect(db.removeSource).toHaveBeenCalledWith('a'));
		expect(db.removeSource).not.toHaveBeenCalledWith('b');
	});

	it('says so when the list can’t be refreshed after a removal that worked', async () => {
		db.sourceRemoval.mockResolvedValue(counts);
		const onremoved = vi.fn(async () => {
			throw new Error('the project is busy');
		});
		const view = render(RemoveSource, {
			props: { id: 'a', title: 'Paper A', csl: null, onremoved }
		});

		await fireEvent.click(view.getByRole('button', { name: 'Remove from library…' }));
		const dialog = await view.findByRole('dialog');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

		await waitFor(() =>
			expect(toast.errorToast).toHaveBeenCalledWith(
				'Removed, but the list of sources could not be refreshed: the project is busy'
			)
		);
		expect(toast.successToast).toHaveBeenCalled();
	});

	describe('a PDF left open on it (after #222)', () => {
		// The work's own file, a preprint attached to it, and another paper.
		const own = '/thesis/papers/a.pdf';
		const attached = '/home/me/Downloads/a-preprint.pdf';
		const other = '/thesis/papers/b.pdf';
		const pdf = (path: string) => ({ id: path, kind: 'pdf' as const, title: path });

		async function removeA() {
			const view = render(RemoveSource, {
				props: { id: 'a', title: 'Paper A', csl: null, onremoved: vi.fn() }
			});
			await fireEvent.click(view.getByRole('button', { name: 'Remove from library…' }));
			const dialog = await view.findByRole('dialog');
			await fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
		}

		it('closes every tab on the work’s files, in either pane, and drops their marks', async () => {
			db.sourceRemoval.mockResolvedValue({ ...counts, paths: [own, attached] });
			workspaceStore.open(pdf(own));
			workspaceStore.open(pdf(other));
			workspaceStore.open(pdf(attached));
			workspaceStore.split();
			const [, right] = get(workspaceStore).panes.map((p) => p.id);
			workspaceStore.open(pdf(own), right);

			await removeA();

			await waitFor(() => expect(toast.successToast).toHaveBeenCalled());
			const ws = get(workspaceStore);
			expect(Object.keys(ws.tabs)).toEqual([other]);
			// The right pane held only the removed files, so it went too.
			expect(ws.panes).toHaveLength(1);
			expect(annotations.dropIf).toHaveBeenCalledOnce();
			const gone = annotations.dropIf.mock.calls[0][0] as (path: string) => boolean;
			expect([own, attached, other].map(gone)).toEqual([true, true, false]);
		});

		it('leaves them open when the removal fails', async () => {
			db.sourceRemoval.mockResolvedValue({ ...counts, paths: [own] });
			db.removeSource.mockRejectedValueOnce(new Error('the library is locked'));
			workspaceStore.open(pdf(own));

			await removeA();

			await waitFor(() => expect(toast.errorToast).toHaveBeenCalled());
			expect(Object.keys(get(workspaceStore).tabs)).toEqual([own]);
			expect(annotations.dropIf).not.toHaveBeenCalled();
		});
		it('closes a file found somewhere new after the dialog opened', async () => {
			// Counted with one place; by the time Remove is pressed, M1b-7 has
			// found the file somewhere else too.
			db.sourceRemoval
				.mockResolvedValueOnce({ ...counts, paths: [own] })
				.mockResolvedValueOnce({ ...counts, paths: [own, attached] });
			workspaceStore.open(pdf(attached));

			await removeA();

			await waitFor(() => expect(toast.successToast).toHaveBeenCalled());
			expect(Object.keys(get(workspaceStore).tabs)).toEqual([]);
		});

		it('gives the marks back to a reader still open in the other pane', async () => {
			// The store held the removed paper, opened last; the other pane's
			// reader would otherwise draw no marks and save new ones to no paper.
			db.sourceRemoval.mockResolvedValue({ ...counts, paths: [own] });
			annotations.dropIf.mockReturnValueOnce(true);
			const reader = readerStore.register({ paneId: 'pane-2', path: other, navigate: vi.fn() });

			await removeA();

			await waitFor(() => expect(annotations.openPath).toHaveBeenCalledWith(other));
			reader.release();
		});
	});
});
