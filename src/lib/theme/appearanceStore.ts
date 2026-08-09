import { writable, get } from 'svelte/store';
import { load as loadStore, type Store } from '@tauri-apps/plugin-store';

import { DEFAULT_APPEARANCE, applyAppearance, normalise, type Appearance } from './theme';

/**
 * The appearance the app is currently wearing.
 *
 * Applied to `<html>` on every change rather than read by components, so a
 * component never has to know which theme is on — it uses a token and gets the
 * right value. That is the whole point of the token layer, and it is what makes
 * adding a third theme a change to one CSS file.
 */

const KEY = 'appearance';
const SETTINGS_FILE = 'settings-store.json';

let store: Store | undefined;
let media: MediaQueryList | undefined;

async function settings(): Promise<Store> {
	store ??= await loadStore(SETTINGS_FILE);
	return store;
}

function prefersDark(): boolean {
	return media?.matches ?? false;
}

function createAppearanceStore() {
	const { subscribe, set } = writable<Appearance>(DEFAULT_APPEARANCE);

	function apply(next: Appearance) {
		set(next);
		if (typeof document === 'undefined') return;

		applyAppearance(document.documentElement, next, prefersDark());

		// Mirrored somewhere synchronous. The settings file is read after mount,
		// which is a frame too late: someone who chose light on a dark machine
		// would see dark first on every launch. localStorage is readable by the
		// inline script in app.html before anything paints.
		try {
			localStorage.setItem('erti.theme', next.theme);
		} catch {
			// Private mode, or storage full. The OS preference is a fine fallback.
		}
	}

	return {
		subscribe,

		/**
		 * Read the stored appearance and put it on. Call before the app renders.
		 *
		 * A failure here is not worth stopping for: the defaults are usable, and an
		 * unreadable settings file should not keep someone out of their manuscript.
		 */
		async initialise() {
			if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
				media = window.matchMedia('(prefers-color-scheme: dark)');
				// Following the system means following it while the app is open, not
				// only at launch — macOS switches at sunset and the app should too.
				media.addEventListener('change', () => {
					if (get(appearanceStore).theme === 'system') apply(get(appearanceStore));
				});
			}

			try {
				apply(normalise((await (await settings()).get(KEY)) as Partial<Appearance>));
			} catch (error) {
				console.error('Could not read the stored appearance:', error);
				apply(DEFAULT_APPEARANCE);
			}
		},

		/** Change one part of the appearance and remember it. */
		async update(patch: Partial<Appearance>) {
			const next = normalise({ ...get(appearanceStore), ...patch });
			apply(next);

			try {
				const s = await settings();
				await s.set(KEY, next);
				await s.save();
			} catch (error) {
				// The change is already on screen; only persistence failed, so it is
				// reported rather than reverted under the user.
				console.error('Could not save the appearance:', error);
			}
		},

		async reset() {
			await this.update(DEFAULT_APPEARANCE);
		}
	};
}

export const appearanceStore = createAppearanceStore();
