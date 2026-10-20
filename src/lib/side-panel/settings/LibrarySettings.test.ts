import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { load } from '@tauri-apps/plugin-store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFakeBackend } from '$lib/harness/testing';
import { commands, run } from '$lib/ipc';
import { saveBeforeReopen } from '$lib/stores/backups';
import { dismissToast, toasts } from '$lib/ui/Toast.svelte';

import LibrarySettings from './LibrarySettings.svelte';

const reopened = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/backups', async (original) => ({
	...(await original<typeof import('$lib/stores/backups')>()),
	// jsdom can't reload; what it would have been told is enough.
	reopenAfterRestore: reopened
}));

const backend = useFakeBackend();

beforeEach(async () => {
	reopened.mockClear();
	for (const t of [...toasts]) dismissToast(t.id);
	await run(commands.openLibrary('/fake/home/Erti/library.db'));
});

const called = (cmd: string) => backend().calls.filter((c) => c.cmd === cmd);
const said = () => toasts.map((t) => [t.title, t.description]);

describe('Settings › Library', () => {
	it('M5-10 AC-1: says where the library is, from the home folder', async () => {
		render(LibrarySettings);
		expect(await screen.findByText('~/Erti/library.db')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Move library…' })).toHaveAccessibleDescription(
			'Location ~/Erti/library.db'
		);
	});

	it('M5-10 AC-1: moves the library to a folder that’s picked, and says where it went', async () => {
		const user = userEvent.setup();
		backend().dialogAnswers.push('/fake/home/Dropbox');
		render(LibrarySettings);
		await screen.findByText('~/Erti/library.db');

		await user.click(screen.getByRole('button', { name: 'Move library…' }));

		expect(await screen.findByText('~/Dropbox/library.db')).toBeInTheDocument();
		expect(screen.getByText('~/Dropbox/backups')).toBeInTheDocument();
		expect(called('move_library')).toEqual([
			{ cmd: 'move_library', args: { folder: '/fake/home/Dropbox' } }
		]);
		expect(said()).toContainEqual(['Moved the library to ~/Dropbox/library.db', undefined]);
		// Where the next launch looks.
		const settings = await load('settings-store.json');
		expect(await settings.get('libraryPath')).toBe('/fake/home/Dropbox/library.db');
	});

	it('M5-10 AC-1: does nothing when the folder picker is closed', async () => {
		const user = userEvent.setup();
		backend().dialogAnswers.push(null);
		render(LibrarySettings);
		await screen.findByText('~/Erti/library.db');
		await user.click(screen.getByRole('button', { name: 'Move library…' }));
		await waitFor(() => expect(called('plugin:dialog|open')).toHaveLength(1));
		expect(called('move_library')).toEqual([]);
	});

	it('M5-10 AC-1: says why a move was refused, and stays where it was', async () => {
		const user = userEvent.setup();
		backend().dialogAnswers.push('/fake/home/Taken');
		backend().files.set('/fake/home/Taken/library.db', 'theirs');
		render(LibrarySettings);
		await screen.findByText('~/Erti/library.db');
		await user.click(screen.getByRole('button', { name: 'Move library…' }));
		await waitFor(() =>
			expect(said()).toContainEqual([
				"There's already a library.db in that folder. Choose another folder, or move that file out first.",
				undefined
			])
		);
		expect(screen.getByText('~/Erti/library.db')).toBeInTheDocument();
	});

	it('M5-10 AC-2: says when the last backup was and what’s kept, and backs up now', async () => {
		const user = userEvent.setup();
		backend().state.backups = [
			{ name: 'library-2026-01-05.db', takenAt: new Date(2026, 0, 5, 18, 40).getTime() }
		];
		render(LibrarySettings);
		expect(
			await screen.findByText(/^5 January( 2026)?, 18:40 · 7 daily and 4 weekly kept$/)
		).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Back up now' }));

		expect(await screen.findByText(/^Today, \d\d:\d\d · 7 daily and 4 weekly kept$/)).toBeVisible();
		expect(called('back_up_library')).toHaveLength(1);
	});

	it('M5-10 AC-2: says there’s no backup yet, and offers none to restore', async () => {
		backend().state.backups = [];
		render(LibrarySettings);
		expect(await screen.findByText('None yet · 7 daily and 4 weekly kept')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Restore from a backup…' })).toBeDisabled();
	});

	it('M5-10 AC-2: restores the backup chosen, after saying what happens, then reopens', async () => {
		const user = userEvent.setup();
		render(LibrarySettings);
		await user.click(await screen.findByRole('button', { name: 'Restore from a backup…' }));

		const dialog = await screen.findByRole('dialog', { name: 'Restore from a backup' });
		expect(dialog).toHaveAccessibleDescription(/kept in the backup folder/);
		const cards = within(dialog).getAllByRole('radio');
		expect(cards).toHaveLength(4);
		// The newest is chosen to start with; an upgrade's copy says so.
		expect(cards[0]).toHaveAttribute('aria-checked', 'true');
		expect(cards[3]).toHaveAccessibleName(/Taken before an upgrade/);

		await user.click(cards[1]);
		await user.click(within(dialog).getByRole('button', { name: 'Restore this backup' }));

		await waitFor(() => expect(reopened).toHaveBeenCalledOnce());
		const name = backend().state.backups[1].name;
		expect(called('restore_library')).toEqual([{ cmd: 'restore_library', args: { name } }]);
		expect(reopened.mock.calls[0][0]).toMatch(/^library-replaced-/);
	});

	it('M5-10 AC-2: restores nothing when the open document can’t be saved first', async () => {
		const user = userEvent.setup();
		const stop = saveBeforeReopen(async () => false);
		try {
			render(LibrarySettings);
			await user.click(await screen.findByRole('button', { name: 'Restore from a backup…' }));
			const dialog = await screen.findByRole('dialog', { name: 'Restore from a backup' });
			await user.click(within(dialog).getByRole('button', { name: 'Restore this backup' }));

			await waitFor(() =>
				expect(said()).toContainEqual([
					"Couldn't save your document, so nothing was restored. Try again.",
					undefined
				])
			);
			expect(called('restore_library')).toEqual([]);
			expect(reopened).not.toHaveBeenCalled();
		} finally {
			stop();
		}
	});

	it('M5-10 AC-2: opens the backup folder', async () => {
		const user = userEvent.setup();
		render(LibrarySettings);
		expect(await screen.findByText('~/Erti/backups')).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Open backup folder' }));
		await waitFor(() => expect(called('open_backup_folder')).toHaveLength(1));
	});
});
