/**
 * The real app, driven through WebDriver (M1a-2, docs/testing.md).
 *
 * `tauri-driver` speaks WebDriver and launches the built binary under
 * WebKitGTK's own driver, so these journeys run the real Rust backend, the real
 * webview and the real CSP. Linux only: macOS has no WKWebView driver, and the
 * browser harness (`e2e/`) covers the UI everywhere else.
 *
 * Build first: `pnpm tauri build --debug --no-bundle`. Then `pnpm e2e:app`,
 * under `xvfb-run` on a machine with no display.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { browser } from '@wdio/globals';

import { makeHome } from './fixture.mjs';

const APP = resolve(import.meta.dirname, '../src-tauri/target/debug/Erti');
const DRIVER = process.env.TAURI_DRIVER ?? resolve(homedir(), '.cargo', 'bin', 'tauri-driver');

const RESULTS = resolve(import.meta.dirname, 'results');

let driver;

export const config = {
	runner: 'local',
	hostname: '127.0.0.1',
	port: 4444,
	specs: ['./specs/**/*.e2e.mjs'],
	maxInstances: 1,
	capabilities: [{ maxInstances: 1, 'tauri:options': { application: APP } }],
	logLevel: 'warn',
	reporters: ['spec'],
	framework: 'mocha',
	mochaOpts: { ui: 'bdd', timeout: 180_000 },
	waitforTimeout: 30_000,

	onPrepare() {
		mkdirSync(RESULTS, { recursive: true });
	},

	/**
	 * Each spec file gets a fresh home and its own driver, so journeys can't
	 * see each other's library. The home is exported for the spec to reach its
	 * project and settings.
	 */
	beforeSession(_config, _capabilities, specs) {
		// Journey 1 cites, which needs metadata, which needs a lookup.
		const lookups = specs.some((spec) => spec.includes('writing'));
		const fixture = makeHome({ settings: { allowNetworkLookups: lookups } });
		process.env.ERTI_E2E_HOME = fixture.home;
		process.env.ERTI_E2E_PROJECT = fixture.project;
		// The XDG variables are dropped so the app's data resolves under HOME.
		const env = { ...process.env, HOME: fixture.home };
		delete env.XDG_DATA_HOME;
		delete env.XDG_CONFIG_HOME;
		delete env.XDG_CACHE_HOME;
		// WebKitGTK's GPU paths crash under Xvfb once a page draws to a canvas,
		// which the PDF reader does. Software rendering is what a virtual display
		// has anyway.
		env.WEBKIT_DISABLE_DMABUF_RENDERER = '1';
		env.WEBKIT_DISABLE_COMPOSITING_MODE = '1';
		env.RUST_BACKTRACE = '1';
		driver = spawn(DRIVER, [], { stdio: [null, process.stdout, process.stderr], env });
	},

	afterSession() {
		driver?.kill();
	},

	/** What the window showed and said when a step failed. */
	async afterTest(test, _context, { passed }) {
		if (passed) return;
		const name = test.title.replace(/\W+/g, '-');
		await browser.saveScreenshot(resolve(RESULTS, `${name}.png`)).catch(() => {});
		const text = await browser
			.execute(
				() => `${document.body.innerText}\n\n--- said ---\n${(window.__erti_said ?? []).join('\n')}`
			)
			.catch((e) => String(e));
		writeFileSync(resolve(RESULTS, `${name}.txt`), text);
	}
};
