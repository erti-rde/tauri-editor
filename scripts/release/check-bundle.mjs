#!/usr/bin/env node
// Release gate 4 (docs/release.md): every bundle carries the model and the
// citation resources. Usage: check-bundle.mjs <target>, after `tauri build`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { missingResources } from './lib.mjs';

const target = process.argv[2];
// Absolute: the AppImage is run from inside a scratch folder.
const bundles = resolve('src-tauri', 'target', target, 'release', 'bundle');
if (!existsSync(bundles)) {
	console.error(`✗ No bundles in ${bundles}. Build first.`);
	process.exit(1);
}

/** Every file under `dir`, relative to it. */
function walk(dir, root = dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path, root) : [relative(root, path)];
	});
}

const find = (ext) =>
	walk(bundles)
		.filter((f) => f.endsWith(ext))
		.map((f) => join(bundles, f));

/** Each artefact, and how to list what's inside it. */
const listings = [];
for (const app of readdirSync(bundles).includes('macos')
	? readdirSync(join(bundles, 'macos'))
	: []) {
	if (app.endsWith('.app')) listings.push([app, walk(join(bundles, 'macos', app))]);
}
for (const deb of find('.deb')) {
	listings.push([deb, execFileSync('dpkg-deb', ['-c', deb], { encoding: 'utf8' }).split('\n')]);
}
for (const image of find('.AppImage')) {
	const out = mkdtempSync(join(tmpdir(), 'appimage-'));
	execFileSync(image, ['--appimage-extract'], { cwd: out, stdio: 'ignore' });
	listings.push([image, walk(join(out, 'squashfs-root'))]);
}
for (const exe of find('-setup.exe')) {
	listings.push([exe, execFileSync('7z', ['l', '-slt', exe], { encoding: 'utf8' }).split('\n')]);
}

if (listings.length === 0) {
	console.error(`✗ No .app, .deb, AppImage or installer found under ${bundles}.`);
	process.exit(1);
}

let failed = false;
for (const [artefact, listing] of listings) {
	const missing = missingResources(listing);
	if (missing.length > 0) {
		failed = true;
		console.error(`✗ ${artefact} is missing:\n  ${missing.join('\n  ')}`);
	} else {
		console.log(`✓ ${artefact} carries the model and the citation resources.`);
	}
}
process.exit(failed ? 1 : 0);
