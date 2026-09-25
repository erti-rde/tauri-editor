#!/usr/bin/env node
// Release gate 1 (docs/release.md): versions agree with each other and the tag,
// and the CHANGELOG has the section. On a manual dry run there's no tag, so only
// the versions are checked.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import { releaseProblems } from './lib.mjs';

const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;
const problems = releaseProblems({
	packageJson: readFileSync('package.json', 'utf8'),
	tauriConf: readFileSync('src-tauri/tauri.conf.json', 'utf8'),
	cargoToml: readFileSync('src-tauri/Cargo.toml', 'utf8'),
	changelog: existsSync('CHANGELOG.md') ? readFileSync('CHANGELOG.md', 'utf8') : '',
	tag
});

// A release is built from main, never from a branch someone tagged.
if (tag !== undefined) {
	try {
		execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']);
	} catch {
		problems.push(`${tag} isn't on main.`);
	}
}

if (problems.length > 0) {
	for (const problem of problems) console.error(`✗ ${problem}`);
	process.exit(1);
}
console.log(tag ? `✓ ${tag} is ready to build.` : '✓ Versions agree (dry run: no tag).');
