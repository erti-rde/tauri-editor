#!/usr/bin/env node
// Release gate 5 (docs/release.md): checksums, the updater manifest and the
// notes, written into `dist/` beside the downloaded artefacts.
// Usage: assemble.mjs <dist dir> <version> <tag>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { changelogSection, latestJson, releaseNotes, sha256sums } from './lib.mjs';

const [dist, version, tag] = process.argv.slice(2);
const names = readdirSync(dist).filter((n) => !n.endsWith('.sig'));

writeFileSync(
	join(dist, 'SHA256SUMS.txt'),
	sha256sums(names.map((name) => ({ name, bytes: readFileSync(join(dist, name)) })))
);

const section = changelogSection(readFileSync('CHANGELOG.md', 'utf8'), version) ?? '';
writeFileSync('release-notes.md', releaseNotes(section));

const manifest = latestJson({
	version,
	notes: section,
	pubDate: new Date().toISOString(),
	baseUrl: `https://github.com/erti-rde/tauri-editor/releases/download/${tag}`,
	artefacts: names.map((name) => ({
		name,
		signature: existsSync(join(dist, `${name}.sig`))
			? readFileSync(join(dist, `${name}.sig`), 'utf8')
			: undefined
	}))
});
if (manifest) {
	writeFileSync(join(dist, 'latest.json'), JSON.stringify(manifest, null, 2));
	console.log(`✓ latest.json for ${Object.keys(manifest.platforms).join(', ')}.`);
} else {
	console.warn('! Nothing is signed for the updater, so there is no latest.json (M7a-2).');
}
console.log(`✓ SHA256SUMS.txt for ${names.length} files.`);
