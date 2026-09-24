import { writable } from 'svelte/store';
import { load as loadStore } from '@tauri-apps/plugin-store';

/**
 * Whether the margin may point out an unused note.
 *
 * On by default, because a feature nobody discovers is not a feature — and this
 * is the part of the reading work that reaches back into the writing, which is
 * the whole reason for it. It is also the one part that speaks unasked, so it is
 * a single switch away from silence, and the mark it draws is deliberately dull.
 */

const KEY = 'noteNudges';

function createNudgeSetting() {
	const { subscribe, set } = writable(true);

	return {
		subscribe,

		async load() {
			try {
				const store = await loadStore('settings-store.json');
				const value = (await store.get(KEY)) as boolean | undefined;
				// Absent means never chosen, which is not the same as chosen false.
				set(value !== false);
			} catch {
				// An unreadable settings file should not decide this either way.
				set(true);
			}
		},

		async setEnabled(enabled: boolean) {
			set(enabled);
			try {
				const store = await loadStore('settings-store.json');
				await store.set(KEY, enabled);
				await store.save();
			} catch (failure) {
				console.error('Could not remember that preference:', failure);
			}
		}
	};
}

export const nudgeSetting = createNudgeSetting();
