import { $ } from '@wdio/globals';

import { answerConsent, chooseStyle, expect, ingested, openProject } from './app.mjs';

/**
 * Consent declined (M6-4 AC-1): a first launch, answered "Stay offline", then
 * everything that would otherwise go online: a scan of three papers that each
 * print a DOI, and a citation style that has to be downloaded.
 *
 * Under `ERTI_CAPTURE` the summary requires this journey to make no
 * connection at all, and no DNS lookup either.
 */

describe('with lookups declined', () => {
	it('asks once, and stays offline when told to', async () => {
		await answerConsent('Stay offline');
		await openProject();
		expect(await ingested()).toBe(3);
	});

	it('refuses a style that would have to be downloaded, and says why', async () => {
		await chooseStyle('Nature');
		await expect($('[role="alert"]*=lookups are off')).toBeDisplayed();
	});
});
