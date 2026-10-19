import { getCurrentWindow } from '@tauri-apps/api/window';

import { readSetting, writeSetting } from '$lib/settings';

/**
 * How the width is shared between two panes (M5-9).
 *
 * The share is the first pane's, from 0 to 1, kept for each window by its
 * label: a window is where someone has arranged a paper beside a chapter, and
 * the next one may be arranged differently.
 */

/** Below this a pane of prose or a PDF page stops being readable. */
export const PANE_MIN_PX = 280;

/** Where the split starts, and where a double-click puts it back. */
export const EVEN = 0.5;

/**
 * The most the handle can take of the row (`w-2`, half a rem). Counting it at
 * its widest means a narrower one only leaves the panes a little more.
 */
export const HANDLE_PX = 8;

function windowLabel(): string {
	try {
		return getCurrentWindow().label;
	} catch {
		// Outside Tauri (unit tests), there is one window and no label to read.
		return 'main';
	}
}

/**
 * The least and most share the first pane can have in a row this wide, so
 * that neither pane is narrower than `PANE_MIN_PX`. Too narrow for both,
 * the split stays even rather than giving one pane all of it.
 */
export function shareLimits(width: number): { min: number; max: number } {
	const room = width - HANDLE_PX;
	if (room < 2 * PANE_MIN_PX) return { min: EVEN, max: EVEN };
	return { min: PANE_MIN_PX / room, max: 1 - PANE_MIN_PX / room };
}

/** This window's share, or even if it has none yet. */
export async function readShare(label = windowLabel()): Promise<number> {
	const saved = (await readSetting('splitRatio'))[label];
	return typeof saved === 'number' && saved > 0 && saved < 1 ? saved : EVEN;
}

/** Keep this window's share, leaving the other windows' as they are. */
export async function saveShare(share: number, label = windowLabel()): Promise<void> {
	const all = await readSetting('splitRatio');
	await writeSetting('splitRatio', { ...all, [label]: share });
}
