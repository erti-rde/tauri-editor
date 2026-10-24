/**
 * The real app, driven through WebDriver (M1a-2, docs/testing.md).
 *
 * `tauri-driver` speaks WebDriver and launches the built binary under
 * WebKitGTK's own driver, so these journeys run the real Rust backend, the real
 * webview and the real CSP. Linux only: macOS has no WKWebView driver, and the
 * browser harness (`e2e/`) covers the UI everywhere else.
 *
 * Build first: `pnpm tauri build --debug --no-bundle`. Then `pnpm e2e:app`,
 * under `xvfb-run` on a machine with no display. `ERTI_APP` runs another
 * build, such as the release one, and `ERTI_CAPTURE=<folder>` records the
 * network traffic of each journey there (M6-4, `capture.mjs`).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { browser } from '@wdio/globals';

import { proxied, startProxy, traced } from './capture.mjs';
import { makeHome } from './fixture.mjs';

const APP = resolve(
	process.env.ERTI_APP ?? resolve(import.meta.dirname, '../src-tauri/target/debug/Erti')
);
const CAPTURE = process.env.ERTI_CAPTURE ? resolve(process.env.ERTI_CAPTURE) : null;
const DRIVER = process.env.TAURI_DRIVER ?? resolve(homedir(), '.cargo', 'bin', 'tauri-driver');

const RESULTS = resolve(import.meta.dirname, 'results');

let driver;
let capture;

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
		if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
	},

	/**
	 * Each spec file gets a fresh home and its own driver, so journeys can't
	 * see each other's library. The home is exported for the spec to reach its
	 * project and settings.
	 */
	async beforeSession(_config, _capabilities, specs) {
		// Journey 1 cites, which needs metadata, which needs a lookup. The consent
		// journeys start where a first launch does: never asked.
		const lookups = specs.some((spec) => spec.includes('writing'));
		const unasked = specs.some((spec) => spec.includes('consent'));
		const fixture = makeHome({
			settings: { allowNetworkLookups: unasked ? undefined : lookups }
		});
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

		if (!CAPTURE) {
			driver = spawn(DRIVER, [], { stdio: [null, process.stdout, process.stderr], env });
			return;
		}
		const name = basename(specs[0]).replace(/\.e2e\.mjs$/, '');
		const proxy = await startProxy(join(CAPTURE, `${name}.proxy.jsonl`));
		const [program, args] = traced(DRIVER, join(CAPTURE, `${name}.strace`));
		// In a group of its own, so the driver goes with strace at the end:
		// killing strace alone would leave the driver holding its port.
		driver = spawn(program, args, {
			stdio: [null, process.stdout, process.stderr],
			env: proxied(env, proxy.port),
			detached: true
		});
		capture = { name, proxy, store: join(fixture.appData, 'settings-store.json') };
	},

	async afterSession() {
		if (!capture) {
			driver?.kill();
			return;
		}
		try {
			process.kill(-driver.pid);
		} catch (error) {
			// Already gone (strace or the driver died): the proxy still needs
			// closing, and the journey still needs its record for the summary.
			if (error.code !== 'ESRCH') throw error;
		}
		await capture.proxy.close();
		// What the journey left consent at, read from where the app keeps it, so
		// the summary judges each journey by what was actually chosen.
		const stored = existsSync(capture.store)
			? JSON.parse(readFileSync(capture.store, 'utf8')).allowNetworkLookups
			: undefined;
		const consent = stored === true ? 'granted' : stored === false ? 'declined' : 'unasked';
		writeFileSync(
			join(CAPTURE, `${capture.name}.json`),
			JSON.stringify({ journey: capture.name, consent, proxyPort: capture.proxy.port }, null, '\t')
		);
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
