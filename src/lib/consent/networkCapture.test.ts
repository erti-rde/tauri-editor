// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	allowedHosts,
	classify,
	connections,
	judge,
	render
} from '../../../scripts/network-capture/judge.mjs';

/**
 * The rules a network capture of the real app is held to (M6-4). The capture
 * itself runs in CI against the built app; these pin what it concludes.
 */

const root = resolve(__dirname, '../../..');
const csp = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8')).app
	.security.csp;
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
const ALLOWED = allowedHosts(csp, readme);

// Lines as `strace -f -e trace=connect` writes them.
const X11 = '4100 connect(3, {sa_family=AF_UNIX, sun_path=@"/tmp/.X11-unix/X99"}, 20) = 0';
const PROXY = (port: number) =>
	`4180 connect(31, {sa_family=AF_INET, sin_port=htons(${port}), sin_addr=inet_addr("127.0.0.1")}, 16) = -1 EINPROGRESS (Operation now in progress)`;
const DRIVER =
	'4101 connect(5, {sa_family=AF_INET6, sin6_port=htons(4445), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "::1", &sin6_addr), sin6_scope_id=0}, 28) = 0';
const DNS =
	'4180 connect(40, {sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("127.0.0.53")}, 16) = 0';
const DIRECT =
	'4180 connect(41, {sa_family=AF_INET6, sin6_port=htons(443), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "2606:4700::6810:84e5", &sin6_addr), sin6_scope_id=0}, 28) = -1 EINPROGRESS';

const tunnel = (host: string, port = 443, method = 'CONNECT') =>
	JSON.stringify({ at: '2026-10-23T10:00:00.000Z', method, host, port });

const journey = (overrides: Partial<Parameters<typeof judge>[0]>) => ({
	journey: 'consent-granted',
	consent: 'granted',
	proxyPort: 40123,
	trace: [X11, DRIVER].join('\n'),
	proxyLog: '',
	...overrides
});

describe('reading a capture', () => {
	it('M6-4 AC-2: takes the listed hosts from the CSP, as far as the README names them', () => {
		expect(ALLOWED.sort()).toEqual([
			'api.crossref.org',
			'data.crosscite.org',
			'doi.org',
			'raw.githubusercontent.com'
		]);
		expect(allowedHosts("connect-src 'self' https://elsewhere.example", readme)).toEqual([]);
	});

	it('M6-4 AC-2: finds every IP connection in the trace, and leaves out local sockets', () => {
		expect(connections([X11, PROXY(40123), DRIVER, DNS, DIRECT].join('\n'))).toEqual([
			{ address: '127.0.0.1', port: 40123 },
			{ address: '::1', port: 4445 },
			{ address: '127.0.0.53', port: 53 },
			{ address: '2606:4700::6810:84e5', port: 443 }
		]);
	});

	it('M6-4 AC-2: tells the proxy, DNS, the driver and the internet apart', () => {
		const kinds = classify(connections([PROXY(40123), DRIVER, DNS, DIRECT].join('\n')), 40123);
		expect(kinds.proxy).toBe(1);
		expect(kinds.local).toBe(1);
		expect(kinds.dns).toHaveLength(1);
		expect(kinds.direct).toEqual([{ address: '2606:4700::6810:84e5', port: 443 }]);
	});
});

describe('judging a journey', () => {
	it('M6-4 AC-2: passes lookups that reach only listed hosts over HTTPS', () => {
		const { problems, row } = judge(
			journey({
				trace: [X11, PROXY(40123), PROXY(40123)].join('\n'),
				proxyLog: [tunnel('doi.org'), tunnel('api.crossref.org'), tunnel('doi.org')].join('\n')
			}),
			ALLOWED
		);
		expect(problems).toEqual([]);
		expect(row.hosts).toEqual(['doi.org:443 ×2', 'api.crossref.org:443 ×1']);
	});

	it('M6-4 AC-2: counts how a tunnel ended as part of that request, not another', () => {
		const closed = JSON.stringify({ closed: 'doi.org:443', sent: 517, received: 4096 });
		const { problems, row } = judge(
			journey({ proxyLog: [tunnel('doi.org'), closed].join('\n') }),
			ALLOWED
		);
		expect(problems).toEqual([]);
		expect(row.hosts).toEqual(['doi.org:443 ×1']);
	});

	it('M6-4 AC-2: fails an address the app resolved itself, since only a name is on the list', () => {
		const { problems } = judge(journey({ proxyLog: tunnel('172.67.69.3') }), ALLOWED);
		expect(problems).toEqual(["reached 172.67.69.3, which the README doesn't list"]);
	});

	it('M6-4 AC-2: fails a host the README does not list', () => {
		const { problems } = judge(journey({ proxyLog: tunnel('api.example.com') }), ALLOWED);
		expect(problems).toEqual(["reached api.example.com, which the README doesn't list"]);
	});

	it('M6-4 AC-2: fails a listed host reached other than over HTTPS', () => {
		const { problems } = judge(journey({ proxyLog: tunnel('doi.org', 80) }), ALLOWED);
		expect(problems).toEqual(['reached doi.org other than over HTTPS (doi.org:80)']);
		// Anything but a connection: binding a port, or relaying UDP.
		const bound = judge(journey({ proxyLog: tunnel('doi.org', 443, 'SOCKS 2') }), ALLOWED);
		expect(bound.problems).toEqual(['reached doi.org other than over HTTPS (SOCKS 2 doi.org:443)']);
	});

	it('M6-4 AC-2: fails a connection that went around the proxy, whatever the consent', () => {
		const { problems } = judge(journey({ trace: [X11, DIRECT].join('\n') }), ALLOWED);
		expect(problems).toEqual(['connected to 2606:4700::6810:84e5:443 around the proxy']);
	});

	it('M6-4 AC-2: declined means zero connections, and no lookup of a name either', () => {
		const quiet = judge(journey({ journey: 'consent-declined', consent: 'declined' }), ALLOWED);
		expect(quiet.problems).toEqual([]);

		const { problems } = judge(
			journey({
				journey: 'consent-declined',
				consent: 'declined',
				trace: [X11, DNS].join('\n'),
				proxyLog: tunnel('doi.org')
			}),
			ALLOWED
		);
		expect(problems).toEqual([
			'sent requests with lookups declined',
			'looked up 1 name(s) with lookups declined'
		]);
	});

	it('M6-4 AC-2: never asked counts as declined', () => {
		const { problems } = judge(
			journey({ journey: 'marks', consent: 'unasked', proxyLog: tunnel('doi.org') }),
			ALLOWED
		);
		expect(problems).toEqual(['sent requests with lookups unasked']);
	});

	it('M6-4 AC-2: holds the CSP probe to the list, but not to its consent', () => {
		const { problems } = judge(
			journey({ journey: 'csp', consent: 'declined', proxyLog: tunnel('doi.org') }),
			ALLOWED
		);
		expect(problems).toEqual([]);
		expect(
			judge(
				journey({ journey: 'csp', consent: 'declined', proxyLog: tunnel('example.com') }),
				ALLOWED
			).problems
		).toEqual(["reached example.com, which the README doesn't list"]);
	});

	it('M6-4 AC-2: fails a journey whose trace is empty, since it proves nothing', () => {
		const { problems } = judge(journey({ trace: '' }), ALLOWED);
		expect(problems).toEqual(['nothing was traced, so the capture saw nothing']);
	});
});

describe('the summary', () => {
	it('M6-4 AC-2: says what each journey reached, and what broke the rules', () => {
		const results = [
			judge(journey({ proxyLog: tunnel('doi.org') }), ALLOWED),
			judge(journey({ journey: 'consent-declined', consent: 'declined' }), ALLOWED)
		];
		const summary = render(results, {
			build: 'release',
			commit: 'abc123',
			run: 'https://example.invalid/run/1',
			date: '2026-10-23',
			allowed: ALLOWED
		});
		expect(summary).toContain('| consent-granted | granted | doi.org:443 ×1 | 0 | 0 | 1 |');
		expect(summary).toContain('| consent-declined | declined | none | 0 | 0 | 1 |');
		expect(summary).toContain('no journey without consent sent anything');

		const failed = render(
			[
				judge(
					journey({ journey: 'marks', consent: 'declined', proxyLog: tunnel('doi.org') }),
					ALLOWED
				)
			],
			{ build: 'release', commit: 'abc123', date: '2026-10-23', allowed: ALLOWED }
		);
		expect(failed).toContain('- marks: sent requests with lookups declined');
	});
});
