/**
 * Reading a network capture of the real app, and judging it (M6-4).
 *
 * `e2e-app/capture.mjs` leaves three files per journey: the proxy's log of the
 * hosts asked for, `strace`'s log of every `connect`, and the consent the
 * journey ended with. These are the rules the README makes of them:
 *
 * - every host reached is one the README names, and the CSP lets through;
 * - nothing goes around the proxy, so the proxy's list is the whole list;
 * - with lookups not granted, nothing is sent at all: no tunnel, no direct
 *   connection, and no DNS lookup, which would name a host to a resolver.
 */

/** Journeys that fetch from the page on purpose, around the consent gate. */
export const PROBES = new Map([
	[
		'csp',
		'fetches each listed host from the page itself to test the CSP, whatever consent says; its hosts are still checked against the list'
	]
]);

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;

/** @typedef {{ address: string, port: number }} Connection */
/** @typedef {{ method: string, host: string, port: number, count: number }} Request */

/**
 * What one journey left behind.
 * @typedef {object} Captured
 * @property {string} journey
 * @property {string} consent `granted`, `declined` or `unasked`, as the journey ended.
 * @property {number} proxyPort
 * @property {string} trace The `strace` log.
 * @property {string} proxyLog The proxy's JSON lines.
 */

/**
 * Every IP connection in a `strace -e trace=connect` log, with where it went.
 * Unix sockets (the display, D-Bus, WebKit's own processes) aren't traffic and
 * are left out.
 */
export function connections(/** @type {string} */ trace) {
	/** @type {Connection[]} */
	const found = [];
	for (const line of trace.split('\n')) {
		const v4 = /sa_family=AF_INET, sin_port=htons\((\d+)\), sin_addr=inet_addr\("([^"]+)"\)/.exec(
			line
		);
		const v6 =
			/sa_family=AF_INET6, sin6_port=htons\((\d+)\),.*?inet_pton\(AF_INET6, "([^"]+)"/.exec(line);
		const match = v4 ?? v6;
		if (match) found.push({ address: match[2], port: Number(match[1]) });
	}
	return found;
}

/**
 * Sort connections into what they were: to the proxy, a DNS lookup, the
 * driver's own plumbing on this machine, or straight out to the internet.
 */
export function classify(/** @type {Connection[]} */ found, /** @type {number} */ proxyPort) {
	const kinds = {
		proxy: 0,
		dns: /** @type {Connection[]} */ ([]),
		local: 0,
		direct: /** @type {Connection[]} */ ([])
	};
	for (const c of found) {
		const loopback = LOOPBACK.test(c.address);
		if (c.port === 53) kinds.dns.push(c);
		else if (loopback && c.port === proxyPort) kinds.proxy++;
		else if (loopback) kinds.local++;
		else kinds.direct.push(c);
	}
	return kinds;
}

/** What the proxy was asked for, with how often: a tunnel, or plain HTTP. */
export function requests(/** @type {string} */ proxyLog) {
	/** @type {Map<string, Request>} */
	const seen = new Map();
	for (const line of proxyLog.split('\n').filter(Boolean)) {
		const { host, port, method } = JSON.parse(line);
		const key = `${method} ${host} ${port}`;
		const request = seen.get(key) ?? { method, host, port, count: 0 };
		request.count++;
		seen.set(key, request);
	}
	return [...seen.values()];
}

/** How a request reads in the summary: `host:port`, with the method unless a tunnel. */
const describe = (/** @type {Request} */ r) =>
	`${r.method === 'CONNECT' ? '' : `${r.method} `}${r.host}:${r.port}`;

/**
 * The listed hosts: those the CSP's `connect-src` allows over HTTPS and the
 * README names. `networkAllowlist.test.ts` holds the two to the same list.
 */
export function allowedHosts(/** @type {string} */ csp, /** @type {string} */ readme) {
	const connectSrc = csp
		.split(';')
		.map((d) => d.trim().split(/\s+/))
		.find(([name]) => name === 'connect-src');
	return (connectSrc ?? [])
		.filter((source) => source.startsWith('https://'))
		.map((source) => new URL(source).hostname)
		.filter((host) => readme.includes(`\`${host}\``));
}

/**
 * Judge one journey. Returns its summary row and what broke the rules, if
 * anything did.
 */
export function judge(
	/** @type {Captured} */ { journey, consent, proxyPort, trace, proxyLog },
	/** @type {string[]} */ allowed
) {
	/** @type {string[]} */
	const problems = [];
	const reached = requests(proxyLog);
	const kinds = classify(connections(trace), proxyPort);
	const probe = PROBES.has(journey);

	if (!trace.trim()) problems.push('nothing was traced, so the capture saw nothing');
	for (const r of reached) {
		if (!allowed.includes(r.host))
			problems.push(`reached ${r.host}, which the README doesn't list`);
		else if (r.method !== 'CONNECT' || r.port !== 443)
			problems.push(`reached ${r.host} other than over HTTPS (${describe(r)})`);
	}
	for (const c of kinds.direct)
		problems.push(`connected to ${c.address}:${c.port} around the proxy`);
	if (consent !== 'granted' && !probe) {
		if (reached.length) problems.push(`sent requests with lookups ${consent}`);
		if (kinds.dns.length)
			problems.push(`looked up ${kinds.dns.length} name(s) with lookups ${consent}`);
	}

	return {
		row: {
			journey,
			consent,
			probe,
			hosts: reached.map((r) => `${describe(r)} ×${r.count}`),
			proxied: kinds.proxy,
			direct: kinds.direct.length,
			dns: kinds.dns.length,
			local: kinds.local
		},
		problems
	};
}

/** The committed summary, as Markdown. */
export function render(
	/** @type {ReturnType<typeof judge>[]} */ results,
	/** @type {{ build: string, commit: string, run?: string, date: string, allowed: string[] }} */ {
		build,
		commit,
		run,
		date,
		allowed
	}
) {
	const lines = [
		'# Network capture',
		'',
		`What the ${build} build of Erti sent over the network, journey by journey (M6-4): the`,
		'real-app journeys, run behind a logging proxy and under `strace`. `docs/testing.md` says how',
		'to run it again.',
		'',
		`- **Build:** ${build}, commit \`${commit}\`, ${date}`,
		...(run ? [`- **Run:** ${run}`] : []),
		`- **Listed hosts:** ${allowed.map((h) => `\`${h}\``).join(', ')}`,
		'',
		'| Journey | Consent | Hosts reached, through the proxy | Around the proxy | DNS lookups | Local plumbing |',
		'| --- | --- | --- | --- | --- | --- |',
		...results.map(
			({ row }) =>
				`| ${row.journey}${row.probe ? ' (probe)' : ''} | ${row.consent} | ${row.hosts.join(', ') || 'none'} | ${row.direct} | ${row.dns} | ${row.local} |`
		),
		''
	];
	const probes = results.filter(({ row }) => row.probe);
	if (probes.length) {
		lines.push(
			...probes.map(({ row }) => `- **${row.journey}** is a probe: it ${PROBES.get(row.journey)}.`),
			''
		);
	}
	const problems = results.flatMap(({ row, problems }) =>
		problems.map((p) => `${row.journey}: ${p}`)
	);
	lines.push(
		problems.length
			? `**Broke the rules:**\n\n${problems.map((p) => `- ${p}`).join('\n')}`
			: 'Every host reached is on the list, nothing went around the proxy, and no journey without consent sent anything.',
		''
	);
	return lines.join('\n');
}
