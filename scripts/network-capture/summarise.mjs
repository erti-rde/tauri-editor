/**
 * Summarise a network capture of the real app (M6-4), and fail if it broke
 * the README's rules.
 *
 *   node scripts/network-capture/summarise.mjs <capture folder> [--out file]
 *     [--build release|debug] [--run <url>]
 *
 * The capture folder is what `ERTI_CAPTURE` pointed the journeys at.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { allowedHosts, judge, render } from './judge.mjs';

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		out: { type: 'string' },
		build: { type: 'string', default: 'debug' },
		run: { type: 'string' },
		commit: { type: 'string', default: process.env.GITHUB_SHA ?? 'unknown' }
	}
});
const [folder] = positionals;
if (!folder) {
	console.error('usage: summarise.mjs <capture folder> [--out file] [--build release] [--run url]');
	process.exit(2);
}

const root = resolve(import.meta.dirname, '../..');
const csp = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8')).app.security
	.csp;
const allowed = allowedHosts(csp, readFileSync(join(root, 'README.md'), 'utf8'));
// Both logs are opened before a journey starts, so a missing one means the
// capture didn't run for it, not that nothing was sent.
const read = (path) => {
	if (!existsSync(path)) {
		console.error(`${path} is missing, so that journey wasn't captured.`);
		process.exit(1);
	}
	return readFileSync(path, 'utf8');
};

const journeys = readdirSync(folder)
	.filter((name) => /^[\w-]+\.json$/.test(name))
	.sort();
// The two the rules are about (M6-4 AC-1); without them a pass proves little.
for (const required of ['consent-declined', 'consent-granted']) {
	if (!journeys.includes(`${required}.json`)) {
		console.error(`The ${required} journey wasn't captured in ${folder}.`);
		process.exit(1);
	}
}

const results = journeys.map((file) => {
	const meta = JSON.parse(readFileSync(join(folder, file), 'utf8'));
	return judge(
		{
			...meta,
			trace: read(join(folder, `${meta.journey}.strace`)),
			proxyLog: read(join(folder, `${meta.journey}.proxy.jsonl`))
		},
		allowed
	);
});

const summary = render(results, {
	build: values.build,
	commit: values.commit.slice(0, 12),
	run: values.run,
	date: new Date().toISOString().slice(0, 10),
	allowed
});
if (values.out) writeFileSync(values.out, summary);
console.log(summary);

process.exit(results.some(({ problems }) => problems.length) ? 1 : 0);
