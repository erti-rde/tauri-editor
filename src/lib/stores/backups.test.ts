import { describe, expect, it, vi } from 'vitest';

type Handler = (event: { payload: string }) => void;
const handlers: Record<string, Handler> = {};

vi.mock('@tauri-apps/api/event', () => ({
	listen: vi.fn(async (name: string, handler: Handler) => {
		handlers[name] = handler;
		return () => {};
	})
}));
vi.mock('$lib/toast/Toast.svelte', () => ({ errorToast: vi.fn() }));

const { watchBackups } = await import('./backups');

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
