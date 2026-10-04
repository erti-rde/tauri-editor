import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { writable } from 'svelte/store';

const { db, toast } = vi.hoisted(() => ({
	db: {
		sourceAliases: vi.fn(async () => ({})),
		sourceRemoval: vi.fn(),
		removeSource: vi.fn(async () => {})
	},
	toast: { errorToast: vi.fn(), successToast: vi.fn() }
}));

vi.mock('$lib/stores/db', () => db);
vi.mock('$lib/toast/Toast.svelte', () => toast);
vi.mock('$lib/stores/fileSystem.svelte', () => ({
	fileSystemStore: writable({ items: [], currentPath: '/thesis' })
}));

import RemoveSource from './RemoveSource.svelte';

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
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
});
