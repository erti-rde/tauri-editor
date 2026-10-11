import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

/**
 * The two switches in Settings › Reading (M3-4). The settings file lives
 * outside the module, so re-importing the module is a restart.
 */

const file = vi.hoisted(() => new Map<string, unknown>());

vi.mock('@tauri-apps/plugin-store', () => ({
	load: vi.fn(async () => ({
		get: async (key: string) => file.get(key),
		set: async (key: string, value: unknown) => void file.set(key, value),
		delete: async (key: string) => file.delete(key),
		save: async () => {}
	}))
}));

/** A fresh start of the app: the module loaded again, the file as it was. */
async function restart() {
	vi.resetModules();
	return import('./writingSettings');
}

beforeEach(() => file.clear());

describe('Follow my writing and Margin nudge', () => {
	// M3-4 AC-1
	it('are both on, on a first launch', async () => {
		const { followSetting, nudgeSetting } = await restart();
		await Promise.all([followSetting.load(), nudgeSetting.load()]);

		expect(get(followSetting)).toBe(true);
		expect(get(nudgeSetting)).toBe(true);
	});

	// M3-4 AC-1: persisted, and read without Settings ever being opened.
	it.each([
		['followSetting', 'followWriting'],
		['nudgeSetting', 'noteNudges']
	] as const)('%s stays off after a restart', async (name, key) => {
		const before = await restart();
		await before[name].setEnabled(false);
		expect(file.get(key)).toBe(false);

		// Only looked at, as the editor and the panel do: nothing asks it to load.
		const after = await restart();
		const seen: boolean[] = [];
		const stop = after[name].subscribe((on) => seen.push(on));
		await vi.waitFor(() => expect(seen.at(-1)).toBe(false));
		stop();
	});

	it('are independent of each other', async () => {
		const { followSetting, nudgeSetting } = await restart();
		await followSetting.setEnabled(false);

		const after = await restart();
		await Promise.all([after.followSetting.load(), after.nudgeSetting.load()]);
		expect(get(after.followSetting)).toBe(false);
		expect(get(after.nudgeSetting)).toBe(true);
		expect(get(nudgeSetting)).toBe(true);
	});

	it('keeps a choice made before the file answered', async () => {
		file.set('followWriting', true);
		const { followSetting } = await restart();

		const loading = followSetting.load();
		await followSetting.setEnabled(false);
		await loading;

		expect(get(followSetting)).toBe(false);
	});
});
