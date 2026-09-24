#!/usr/bin/env node
/**
 * The browser harness must not ship (M1a-1 AC-1).
 *
 * `src/routes/harness` loads the fake backend only in `--mode harness`, and the
 * branch is dead code in a production build. This checks that the build
 * agrees: none of the fake's code, fixtures or sample PDF is in `build/`. Run
 * after `pnpm build`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BUILD = 'build';

// Strings only the harness contains.
const MARKERS = [
	'Fake backend: no handler',
	'/fake/home/Documents/Thesis',
	'Sample Paper for the Erti Harness'
];

function* files(dir) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) yield* files(path);
		else yield path;
	}
}

let checked = 0;
const found = [];
for (const path of files(BUILD)) {
	checked++;
	if (path.endsWith('.pdf') && !path.includes('pdf-assets')) found.push(`${path}: a PDF`);
	if (!/\.(js|html|css|json)$/.test(path)) continue;
	const text = readFileSync(path, 'utf8');
	for (const marker of MARKERS) if (text.includes(marker)) found.push(`${path}: "${marker}"`);
}

if (checked === 0) {
	console.error(`Nothing in ${BUILD}/. Run \`pnpm build\` first.`);
	process.exit(1);
}
if (found.length > 0) {
	console.error('The browser harness reached the production build:');
	for (const line of found) console.error(`  ${line}`);
	process.exit(1);
}
console.log(`The harness is not in the production build (${checked} files checked).`);
