import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

import { setSystemTheme } from '../../../vitest.setup';

/**
 * The layer where the appearance bugs actually lived.
 *
 * `theme.ts` is pure and was tested; the store is what reads the settings file,
 * puts the result on `<html>`, and keeps following the OS while the app is
 * open. None of that had a test, and every appearance bug reported so far —
 * "light does nothing", "text disappears" — was in this seam rather than in the
 * pure functions underneath it.
 */

const store = { get: vi.fn(), set: vi.fn(), save: vi.fn() };

vi.mock('@tauri-apps/plugin-store', () => ({
	load: vi.fn(async () => store)
}));

// Imported after the mock is registered, since it loads the plugin at module
// scope.
const { appearanceStore } = await import('./appearanceStore');

beforeEach(() => {
	store.get.mockReset().mockResolvedValue(undefined);
	store.set.mockReset().mockResolvedValue(undefined);
	store.save.mockReset().mockResolvedValue(undefined);
	setSystemTheme(false);
	localStorage.clear();
	document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('putting the stored appearance on', () => {
	it('applies what was saved, not the default', async () => {
		store.get.mockResolvedValue({ theme: 'night-owl', density: 'comfortable' });

		await appearanceStore.initialise();

		expect(document.documentElement.dataset.theme).toBe('night-owl');
		expect(document.documentElement.dataset.density).toBe('comfortable');
	});

	it('mirrors the choice somewhere the pre-paint script can read', async () => {
		// The settings file is only readable after mount, which is a frame too
		// late: the app would flash the wrong theme on every launch.
		store.get.mockResolvedValue({ theme: 'catppuccin-mocha' });

		await appearanceStore.initialise();

		expect(localStorage.getItem('erti.theme')).toBe('catppuccin-mocha');
	});

	it('still opens when the settings file is unreadable', async () => {
		// An unreadable settings file must not keep someone out of their
		// manuscript, so this is logged rather than thrown.
		store.get.mockRejectedValue(new Error('disk is on fire'));

		await appearanceStore.initialise();

		expect(get(appearanceStore).theme).toBe('system');
		expect(document.documentElement.dataset.theme).toBe('light');
	});
});

describe('following the computer', () => {
	it('switches when the OS does, not only at launch', async () => {
		// macOS flips at sunset; an app that only read the preference at launch
		// would sit in light until it was restarted.
		store.get.mockResolvedValue({ theme: 'system' });

		await appearanceStore.initialise();
		expect(document.documentElement.dataset.theme).toBe('light');

		setSystemTheme(true);

		expect(document.documentElement.dataset.theme).toBe('dark');
	});

	it('leaves a chosen palette alone when the OS changes', async () => {
		// Choosing a palette is choosing to stop following.
		store.get.mockResolvedValue({ theme: 'catppuccin-latte' });

		await appearanceStore.initialise();
		setSystemTheme(true);

		expect(document.documentElement.dataset.theme).toBe('catppuccin-latte');
	});
});

describe('changing one thing', () => {
	it('keeps the rest of the appearance', async () => {
		store.get.mockResolvedValue({ theme: 'night-owl', uiSize: 15 });
		await appearanceStore.initialise();

		await appearanceStore.update({ density: 'comfortable' });

		expect(get(appearanceStore)).toMatchObject({
			theme: 'night-owl',
			uiSize: 15,
			density: 'comfortable'
		});
	});

	it('shows the change even when it cannot be saved', async () => {
		// The change is already on screen. Reverting it under the user because a
		// write failed would be the worse of the two outcomes.
		await appearanceStore.initialise();
		store.set.mockRejectedValue(new Error('read-only volume'));

		await appearanceStore.update({ theme: 'catppuccin-mocha' });

		expect(document.documentElement.dataset.theme).toBe('catppuccin-mocha');
		expect(get(appearanceStore).theme).toBe('catppuccin-mocha');
	});
});
