import { describe, expect, it, vi } from 'vitest';

type Handler = (event: { payload: string }) => void;
const handlers: Record<string, Handler> = {};

vi.mock('@tauri-apps/api/event', () => ({
	listen: vi.fn(async (name: string, handler: Handler) => {
		handlers[name] = handler;
		return () => {};
	})
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock('$lib/ui/Toast.svelte', () => ({ errorToast: vi.fn(), toast }));

const { reopenAfterRestore, saveBeforeReopen, savedForReopen, sayIfRestored, watchBackups } =
	await import('./backups');

// M1a-5 AC-5
describe('a failed library backup', () => {
	it('is said once, however many copies failed', async () => {
		const show = vi.fn();
		await watchBackups(show);

		handlers['library-backup-failed']({ payload: 'No space left on device' });
		handlers['library-backup-failed']({ payload: 'No space left on device' });

		expect(show).toHaveBeenCalledTimes(1);
		expect(show.mock.calls[0][0]).toContain('No space left on device');
		expect(show.mock.calls[0][0]).toContain('opened as normal');
	});
});

describe('starting the window again after a restore (M5-10 AC-2)', () => {
	it('M5-10 AC-2: writes what asked to be written first, and says if any of it failed', async () => {
		const first = vi.fn(async () => true);
		const stopFirst = saveBeforeReopen(first);
		expect(await savedForReopen()).toBe(true);

		const stopFailing = saveBeforeReopen(async () => {
			throw new Error('disk full');
		});
		expect(await savedForReopen()).toBe(false);

		stopFailing();
		expect(await savedForReopen()).toBe(true);
		expect(first).toHaveBeenCalledTimes(3);
		stopFirst();
	});

	it('M5-10 AC-2: says once, when the window is back, where the replaced library is kept', () => {
		const reload = vi.fn();
		reopenAfterRestore('library-replaced-2026-10-20-091200.db', reload);
		expect(reload).toHaveBeenCalledOnce();

		sayIfRestored();
		sayIfRestored();
		expect(toast).toHaveBeenCalledOnce();
		expect(toast.mock.calls[0][0]).toMatchObject({
			kind: 'success',
			title: 'Restored your library from a backup',
			description:
				'The library it replaced is kept in the backup folder as library-replaced-2026-10-20-091200.db.',
			action: { label: 'Open backup folder' }
		});
	});
});
