import { $ } from '@wdio/globals';

import { answerConsent, chooseStyle, expect, ingested, openProject } from './app.mjs';

/**
 * Consent granted (M6-4 AC-1): a first launch, answered "Allow lookups", then
 * every kind of request the README lists: each paper resolved from the DOI it
 * prints (doi.org, and the registry it hands on to), and a citation style and
 * its language downloaded from GitHub.
 *
 * Under `ERTI_CAPTURE` the summary requires every host this journey reached
 * to be one the README names.
 */

describe('with lookups allowed', () => {
	it('asks once, and resolves each paper online', async () => {
		await answerConsent('Allow lookups');
		await openProject();
		expect(await ingested()).toBe(3);
	});

	it('downloads a style and its language that do not come with Erti', async () => {
		await chooseStyle('Nature', 'de-DE');
		// Settings closes once both have been fetched and stored.
		await $('#citation-style').waitForDisplayed({ reverse: true, timeout: 60_000 });
		await expect($('[role="alert"]')).not.toBeDisplayed();
	});
});
