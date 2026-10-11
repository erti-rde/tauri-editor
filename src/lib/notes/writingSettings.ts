import { writable } from 'svelte/store';

import { readSetting, writeSetting } from '$lib/settings';
import { log } from '$lib/log';

/**
 * A switch in Settings › Reading that takes effect at once, read from the
 * settings file the first time anything looks at it (M3-4).
 *
 * Read on first use rather than when the Settings tab opens: a switch turned off
 * there has to stay off after a restart, before anyone opens Settings again.
 * Until the file answers, it reads as its default — on — and a choice made in
 * the meantime wins over the file's older answer.
 */
function createSwitchSetting(key: 'noteNudges' | 'followWriting') {
	let chosen = false;
	let loading: Promise<void> | null = null;

	const store = writable(true, () => void load());

	function load(): Promise<void> {
		loading ??= readSetting(key).then(
			(enabled) => {
				if (!chosen) store.set(enabled);
			},
			// An unreadable settings file should not decide this either way.
			(failure) => log.error('Could not read that preference', failure)
		);
		return loading;
	}

	return {
		subscribe: store.subscribe,

		/** Resolves once the file has answered, so a first use can wait for it. */
		load,

		async setEnabled(enabled: boolean) {
			chosen = true;
			store.set(enabled);
			try {
				await writeSetting(key, enabled);
			} catch (failure) {
				log.error('Could not remember that preference', failure);
			}
		}
	};
}

/**
 * Whether the margin may point out an unused note.
 *
 * On by default, because a feature nobody discovers is not a feature — and this
 * is the part of the reading work that reaches back into the writing, which is
 * the whole reason for it. It is also the one part that speaks unasked, so it is
 * a single switch away from silence, and the mark it draws is deliberately dull.
 */
export const nudgeSetting = createSwitchSetting('noteNudges');

/**
 * Whether the Notes panel follows the paragraph being written (M3-1). On by
 * default for the same reason as the nudge, and quieter: it never speaks, it is
 * only there when you look.
 */
export const followSetting = createSwitchSetting('followWriting');
