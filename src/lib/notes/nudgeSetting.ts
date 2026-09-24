import { writable } from 'svelte/store';

import { readSetting, writeSetting } from '$lib/settings';

/**
 * Whether the margin may point out an unused note.
 *
 * On by default, because a feature nobody discovers is not a feature — and this
 * is the part of the reading work that reaches back into the writing, which is
 * the whole reason for it. It is also the one part that speaks unasked, so it is
 * a single switch away from silence, and the mark it draws is deliberately dull.
 */

function createNudgeSetting() {
	const { subscribe, set } = writable(true);

	return {
		subscribe,

		async load() {
			try {
				// Absent means never chosen, which reads as the default: on.
				set(await readSetting('noteNudges'));
			} catch {
				// An unreadable settings file should not decide this either way.
				set(true);
			}
		},

		async setEnabled(enabled: boolean) {
			set(enabled);
			try {
				await writeSetting('noteNudges', enabled);
			} catch (failure) {
				console.error('Could not remember that preference:', failure);
			}
		}
	};
}

export const nudgeSetting = createNudgeSetting();
