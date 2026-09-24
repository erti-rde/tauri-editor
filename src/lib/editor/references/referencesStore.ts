import { writable, get } from 'svelte/store';

import { readSetting, writeSetting } from '$lib/settings';

/**
 * Whether a reference list appears on its own.
 *
 * Its own store rather than a field on the page setup, because it is about what
 * the document contains rather than how the page is laid out — and because the
 * editor has to read it the moment a citation lands, not on the next reload.
 */

function createReferencesSettings() {
	// On by default: a paper with citations needs a works-cited list, and the
	// drafts that go out without one are exactly the ones where somebody forgot.
	const { subscribe, set } = writable(true);

	return {
		subscribe,

		async initialise() {
			try {
				// Only an explicit false turns it off, so a settings file written
				// before this existed still gets the list.
				set(await readSetting('autoReferences'));
			} catch (error) {
				console.error('Could not read the references setting:', error);
				set(true);
			}
		},

		async update(enabled: boolean) {
			set(enabled);

			try {
				await writeSetting('autoReferences', enabled);
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
