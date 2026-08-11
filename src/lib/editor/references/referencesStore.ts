import { writable, get } from 'svelte/store';
import { load as loadStore, type Store } from '@tauri-apps/plugin-store';

/**
 * Whether a reference list appears on its own.
 *
 * Its own store rather than a field on the page setup, because it is about what
 * the document contains rather than how the page is laid out — and because the
 * editor has to read it the moment a citation lands, not on the next reload.
 */

const KEY = 'autoReferences';
const SETTINGS_FILE = 'settings-store.json';

let store: Store | undefined;

async function settings(): Promise<Store> {
	store ??= await loadStore(SETTINGS_FILE);
	return store;
}

function createReferencesSettings() {
	// On by default: a paper with citations needs a works-cited list, and the
	// drafts that go out without one are exactly the ones where somebody forgot.
	const { subscribe, set } = writable(true);

	return {
		subscribe,

		async initialise() {
			try {
				const stored = await (await settings()).get(KEY);
				// Only an explicit false turns it off, so a settings file written
				// before this existed still gets the list.
				set(stored !== false);
			} catch (error) {
				console.error('Could not read the references setting:', error);
				set(true);
			}
		},

		async update(enabled: boolean) {
			set(enabled);

			try {
				const s = await settings();
				await s.set(KEY, enabled);
				await s.save();
			} catch (error) {
				console.error('Could not save the references setting:', error);
			}
		},

		get enabled() {
			return get(autoReferences);
		}
	};
}

export const autoReferences = createReferencesSettings();
