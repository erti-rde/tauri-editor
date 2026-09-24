import { readSetting, writeSetting } from '$lib/settings';

/**
 * Consent for outbound network requests.
 *
 * The README promises that data "never leave your computer without your explicit
 * consent", and then admitted "currently we are not asking any consent" — while
 * ingest was sending paper titles and up to a thousand characters of page text
 * to Crossref, and Settings was fetching citation styles from GitHub.
 *
 * Three states matter, so this is a tri-state rather than a boolean: not yet
 * asked is different from declined, and only the first should raise a prompt.
 */

export type ConsentState = 'unasked' | 'granted' | 'declined';

export async function getConsent(): Promise<ConsentState> {
	const value = await readSetting('allowNetworkLookups');
	if (value === null) return 'unasked';
	return value ? 'granted' : 'declined';
}

export async function setConsent(granted: boolean): Promise<void> {
	await writeSetting('allowNetworkLookups', granted);
}

/** Convenience for call sites that only care whether a request may be made. */
export async function networkAllowed(): Promise<boolean> {
	return (await getConsent()) === 'granted';
}

/**
 * Optional contact address for Crossref's polite pool.
 *
 * Crossref asks API users to identify themselves and gives those requests better
 * service. It is the user's address, so it is theirs to provide or withhold.
 */
export async function getMailto(): Promise<string | undefined> {
	const value = await readSetting('crossrefMailto');
	return value.trim() ? value.trim() : undefined;
}

export async function setMailto(address: string): Promise<void> {
	await writeSetting('crossrefMailto', address.trim());
}
