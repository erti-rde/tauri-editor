import { writable, get } from 'svelte/store';

import { readSetting, writeSetting } from '$lib/settings';

import {
	DEFAULT_PAGE_SETUP,
	normalisePageSetup,
	spacingById,
	toPageRule,
	type PageSetup
} from './paper';

/**
 * How the page is set up, and where that gets applied.
 *
 * A project setting rather than a document one, for now: a thesis is one paper
 * size throughout, and per-document page setup is the sort of thing to add when
 * someone actually needs a landscape appendix.
 */

const STYLE_ID = 'erti-page-rule';

/**
 * Put the `@page` rule in the document.
 *
 * It has to be a live <style> element rather than a line in the stylesheet,
 * because `@page` accepts no custom properties — `size: var(--paper)` is not
 * valid CSS, which is the reason paper size could not be a setting until now.
 */
function applyPageRule(setup: PageSetup) {
	if (typeof document === 'undefined') return;

	let style = document.getElementById(STYLE_ID);
	if (!style) {
		style = document.createElement('style');
		style.id = STYLE_ID;
		document.head.appendChild(style);
	}

	style.textContent = toPageRule(setup);
}

function createPageSetupStore() {
	const { subscribe, set } = writable<PageSetup>(DEFAULT_PAGE_SETUP);

	function apply(next: PageSetup) {
		set(next);
		applyPageRule(next);

		// Line spacing rides on a custom property rather than being written onto
		// the editor element, so it applies to the manuscript in print too — where
		// the element's inline styles survive but the editor instance is not
		// around to have been asked.
		if (typeof document !== 'undefined') {
			document.documentElement.style.setProperty(
				'--page-spacing',
				String(spacingById(next.spacing).value)
			);
		}
	}

	return {
		subscribe,

		/** Read the stored setup and apply it. A failure here is not worth stopping for. */
		async initialise() {
			try {
				apply(normalisePageSetup(await readSetting('pageSetup')));
			} catch (error) {
				console.error('Could not read the page setup:', error);
				apply(DEFAULT_PAGE_SETUP);
			}
		},

		/** Change part of the setup and remember it. */
		async update(patch: Partial<PageSetup>) {
			const next = normalisePageSetup({ ...get(pageSetupStore), ...patch });
			apply(next);

			try {
				await writeSetting('pageSetup', next);
			} catch (error) {
				// Already on screen; only persistence failed, so it is reported
				// rather than reverted under the author mid-sentence.
				console.error('Could not save the page setup:', error);
			}
		},

		async reset() {
			await this.update(DEFAULT_PAGE_SETUP);
		}
	};
}

export const pageSetupStore = createPageSetupStore();
