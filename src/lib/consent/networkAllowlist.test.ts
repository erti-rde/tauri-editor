import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The hosts the webview may connect to, pinned.
 *
 * The README tells researchers exactly what leaves their machine, and the CSP's
 * `connect-src` is where that promise is enforced. Without a `connect-src`, the
 * policy fell back to `default-src 'self'`, and every lookup the README
 * describes was blocked inside the app. The tests never noticed, because they
 * run the resolver in Node, where no CSP applies.
 *
 * Adding a host must be deliberate: it goes in the README's list of what leaves
 * the machine, then here.
 */
const ALLOWED_HOSTS = [
	// DOI resolution, and the registries doi.org hands a request on to.
	'https://doi.org',
	'https://api.crossref.org',
	'https://data.crosscite.org',
	// Citation style and locale files.
	'https://raw.githubusercontent.com'
];

function csp(): Map<string, string[]> {
	const conf = JSON.parse(
		readFileSync(resolve(__dirname, '../../../src-tauri/tauri.conf.json'), 'utf8')
	);
	const policy: string = conf.app.security.csp;
	return new Map(
		policy
			.split(';')
			.map((directive) => directive.trim().split(/\s+/))
			.filter((parts) => parts[0])
			.map(([name, ...sources]) => [name, sources])
	);
}

describe('the network allowlist', () => {
	it('declares connect-src, so connections do not fall back to self only', () => {
		expect(csp().has('connect-src')).toBe(true);
	});

	it('allows exactly the hosts the README lists, and nothing else remote', () => {
		const remote = (csp().get('connect-src') ?? []).filter((source) => source.startsWith('https:'));
		expect(remote.sort()).toEqual([...ALLOWED_HOSTS].sort());
	});

	it('keeps IPC reachable, or the app cannot talk to its own backend', () => {
		expect(csp().get('connect-src')).toEqual(
			expect.arrayContaining(["'self'", 'ipc:', 'http://ipc.localhost'])
		);
	});

	it('names every allowed host in the README', () => {
		const readme = readFileSync(resolve(__dirname, '../../../README.md'), 'utf8');
		for (const host of ALLOWED_HOSTS) {
			expect(readme).toContain(new URL(host).host);
		}
	});
});
