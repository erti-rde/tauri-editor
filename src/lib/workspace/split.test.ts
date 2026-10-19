import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The settings file, in memory, as `settings.test.ts` keeps it. */
const file = vi.hoisted(() => new Map<string, unknown>());
/** How long a write takes, by what it writes: none, unless a test says. */
const slow = vi.hoisted(() => ({ ms: (_value: unknown): number => 0, writes: 0 }));

vi.mock('@tauri-apps/plugin-store', () => ({
	load: vi.fn(async () => ({
		get: async (key: string) => (file.has(key) ? structuredClone(file.get(key)) : undefined),
		set: async (key: string, value: unknown) => {
			slow.writes++;
			const ms = slow.ms(value);
			if (ms) await new Promise((done) => setTimeout(done, ms));
			file.set(key, structuredClone(value));
		},
		delete: async (key: string) => file.delete(key),
		save: async () => {}
	}))
}));

const { EVEN, HANDLE_PX, PANE_MIN_PX, readShare, saveShare, shareLimits } = await import('./split');

beforeEach(() => {
	file.clear();
	slow.ms = () => 0;
	slow.writes = 0;
});

describe('the split, kept', () => {
	it('M5-9 AC-1: starts even in a window that has never been split', async () => {
		expect(await readShare('main')).toBe(EVEN);
	});

	it('M5-9 AC-1: persists per window', async () => {
		await saveShare(0.62, 'main');
		await saveShare(0.4, 'second');

		expect(await readShare('main')).toBe(0.62);
		expect(await readShare('second')).toBe(0.4);
		expect(file.get('splitRatio')).toEqual({ main: 0.62, second: 0.4 });
	});

	it('M5-9 AC-1: keeps the latest of a run of shares, however long each write takes', async () => {
		// A held arrow key: the first write is slow, and the last must still win.
		slow.ms = (value) => ((value as Record<string, number>).main === 0.3 ? 20 : 0);

		await Promise.all([0.3, 0.32, 0.34, 0.36].map((share) => saveShare(share, 'main')));

		expect(await readShare('main')).toBe(0.36);
		// The first, then the latest of those chosen while it was written.
		expect(slow.writes).toBe(2);
	});

	it('M5-9 AC-1: reads anything but a share as even, so a damaged file leaves the panes usable', async () => {
		file.set('splitRatio', { main: 'wide', other: 1.5, third: 0 });
		expect(await readShare('main')).toBe(EVEN);
		expect(await readShare('other')).toBe(EVEN);
		expect(await readShare('third')).toBe(EVEN);
	});
});

describe('the limits on the split', () => {
	it('M5-9 AC-1: keep both panes at 280 px or wider', () => {
		const width = 1208;
		const { min, max } = shareLimits(width);
		const room = width - HANDLE_PX;
		expect(min * room).toBeCloseTo(PANE_MIN_PX);
		expect((1 - max) * room).toBeCloseTo(PANE_MIN_PX);
	});

	it('M5-9 AC-1: hold the split even when the row is too narrow for two panes of 280 px', () => {
		expect(shareLimits(2 * PANE_MIN_PX + HANDLE_PX - 1)).toEqual({ min: EVEN, max: EVEN });
		expect(shareLimits(0)).toEqual({ min: EVEN, max: EVEN });
	});
});
