import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { $, browser, expect } from '@wdio/globals';

/**
 * Journey 5 (M1a-2 AC-3): the network allowlist, enforced by the real webview.
 *
 * `networkAllowlist.test.ts` checks the README and the CSP agree; only the
 * running app shows whether the webview then lets those hosts through. It
 * didn't once: every lookup was blocked in the app while the unit tests passed
 * (#109).
 */

const conf = JSON.parse(
	readFileSync(resolve(import.meta.dirname, '../../src-tauri/tauri.conf.json'), 'utf8')
);
const connectSrc = conf.app.security.csp
	.split(';')
	.map((d) => d.trim())
	.find((d) => d.startsWith('connect-src'))
	.split(/\s+/)
	.filter((s) => s.startsWith('https://'));

/** The endpoints Erti calls on each host, rather than their home pages. */
const ENDPOINTS = {
	'https://doi.org': 'https://doi.org/api/handles/10.1000/1',
	'https://api.crossref.org': 'https://api.crossref.org/works?rows=0',
	'https://data.crosscite.org':
		'https://data.crosscite.org/application/vnd.citationstyles.csl+json/10.1000/1',
	'https://raw.githubusercontent.com':
		'https://raw.githubusercontent.com/citation-style-language/styles/master/apa.csl'
};

/**
 * Fetch each URL from inside the app and return the URLs the CSP blocked.
 * Only violations for the requested hosts count: a response may redirect
 * elsewhere, and where it goes next is that host's business, not the list's.
 */
async function blocked(urls) {
	const violations = await browser.executeAsync((urls, done) => {
		const seen = [];
		document.addEventListener('securitypolicyviolation', (e) => seen.push(e.blockedURI));
		Promise.allSettled(urls.map((u) => fetch(u, { mode: 'no-cors', cache: 'no-store' }))).then(
			// The event is dispatched after the fetch settles; give it a moment.
			() => setTimeout(() => done(seen), 500)
		);
	}, urls);
	const origins = urls.map((u) => new URL(u).origin);
	return violations.filter((v) => origins.some((o) => v.startsWith(o)));
}

describe('the network allowlist in the real webview', () => {
	before(async () => {
		// The app is up once the landing screen is.
		await $('h1=Erti').waitForDisplayed();
	});

	it('lets every host in the CSP through', async () => {
		expect(Object.keys(ENDPOINTS).sort()).toEqual([...connectSrc].sort());
		const violations = await blocked(connectSrc.map((host) => ENDPOINTS[host]));
		expect(violations).toEqual([]);
	});

	it('blocks a host that is not on the list', async () => {
		const violations = await blocked(['https://example.com/']);
		expect(violations.join(' ')).toContain('example.com');
	});
});
