import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What the webview is allowed to ask the Rust side for.
 *
 * Every permission here is something a script injected into the webview could
 * use too, so the list stays as short as the app needs (docs/security.md). The
 * shell plugin was granted and never called from the app (SEC-6, M0-4); opening
 * links is the opener plugin's job, and it also handles `target="_blank"` links.
 */
const capability = JSON.parse(
	readFileSync(resolve(process.cwd(), 'src-tauri/capabilities/default.json'), 'utf8')
) as { permissions: string[] };

describe('the webview capability', () => {
	it('grants nothing from the shell plugin (M0-4 AC-1)', () => {
		expect(capability.permissions.filter((p) => p.startsWith('shell:'))).toEqual([]);
	});

	it('keeps the opener, which opens links in the system browser (M0-4 AC-2)', () => {
		expect(capability.permissions).toContain('opener:default');
	});

	it('does not depend on the shell plugin anywhere', () => {
		const cargo = readFileSync(resolve(process.cwd(), 'src-tauri/Cargo.toml'), 'utf8');
		const pkg = readFileSync(resolve(process.cwd(), 'package.json'), 'utf8');
		expect(cargo).not.toContain('tauri-plugin-shell');
		expect(pkg).not.toContain('@tauri-apps/plugin-shell');
	});

	// M1a-4 AC-1
	it('grants the fs plugin only the calls the app makes, and no scope of its own', () => {
		// Scope comes at runtime: the project folder when it opens, and whatever
		// the user picks in a dialog. `fs:allow-home-read-recursive` let a script
		// in the webview read all of $HOME whatever the Rust commands refused, and
		// `fs:write-all` let it remove files wherever it could write.
		expect(capability.permissions.filter((p) => p.startsWith('fs:')).sort()).toEqual([
			'fs:allow-exists',
			'fs:allow-mkdir',
			'fs:allow-read-file',
			'fs:allow-read-text-file',
			'fs:allow-resource-read-recursive',
			'fs:allow-write-file',
			'fs:allow-write-text-file',
			'fs:default'
		]);
	});

	// M1a-4 AC-1
	it('never lets the webview delete, move or list files', () => {
		const fs = capability.permissions.filter((p) => p.startsWith('fs:'));
		for (const forbidden of ['remove', 'rename', 'write-all', 'read-dir', 'home', 'truncate']) {
			expect(
				fs.filter((p) => p.includes(forbidden)),
				forbidden
			).toEqual([]);
		}
	});
});
