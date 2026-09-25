import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { $, browser, expect } from '@wdio/globals';

/** Steps every journey shares. */

/**
 * Keep what the app says: console errors and every toast, so a step that
 * fails quietly can be read afterwards (they go into `results/` with each
 * snapshot). Toasts leave after five seconds, often before a wait gives up.
 */
export async function listen() {
	await browser.execute(() => {
		if (window.__erti_said) return;
		window.__erti_said = [];
		const said =
			(kind) =>
			(...args) =>
				window.__erti_said.push(
					`${kind}: ${args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')}`
				);
		const original = console.error;
		console.error = (...args) => {
			said('console.error')(...args);
			original(...args);
		};
		new MutationObserver(() => {
			// Toasts carry no role yet (M1c's Toast primitive gives them one), so
			// they're found by their dismiss button.
			for (const dismiss of document.querySelectorAll('button[aria-label="dismiss alert"]')) {
				const text = dismiss.parentElement?.textContent?.replace(/\s+/g, ' ').trim();
				if (text && !window.__erti_said.includes(`toast: ${text}`))
					window.__erti_said.push(`toast: ${text}`);
			}
		}).observe(document.body, { childList: true, subtree: true });
	});
}

export async function openProject() {
	await $('h1=Erti').waitForDisplayed();
	// The default window is 800x600, and the toolbar overflows it.
	await browser.setWindowSize(1280, 900).catch(() => {});
	await listen();
	await $('button*=Thesis').click();
	await $('div*=Chapter 1.erti.json').waitForDisplayed();
}

/**
 * Wait for the scan of the project's PDFs to finish, and say how many made it.
 * The footer's closing message only counts successes, and it clears after a
 * few seconds, so it is polled often and read as soon as it appears.
 */
export async function ingested() {
	let done = null;
	await browser.waitUntil(
		async () => {
			const text = await browser.execute(() => document.body.innerText);
			done = /Completed processing (\d+) PDF files|Error processing PDFs: .*/.exec(text);
			return done !== null;
		},
		{ timeout: 180_000, interval: 200, timeoutMsg: 'the scan of the papers never finished' }
	);
	return done[1] === undefined ? done[0] : Number(done[1]);
}

/**
 * Type into whatever has focus. Through `insertText` rather than key events:
 * WebKitGTK's driver drops the second of two identical keys in a row, so
 * "Attention" arrived as "Atention".
 */
export async function type(text) {
	await browser.execute((text) => document.execCommand('insertText', false, text), text);
}

export async function openPaper(name) {
	const papers = $('div=papers');
	if (!(await $(`div=${name}`).isDisplayed())) await papers.click();
	await $(`div=${name}`).click();
	await $('.textLayer span').waitForDisplayed({ timeout: 60_000 });
}

export async function rail(name) {
	await $(`button[aria-label="${name}"]`).click();
}

export { expect };

/**
 * Save what the window shows now, for reading a run afterwards. The CI job
 * keeps `e2e-app/results`.
 */
export async function snapshot(name) {
	console.log(`${new Date().toISOString()} snapshot ${name}`);
	const dir = resolve(import.meta.dirname, '../results');
	await browser.saveScreenshot(resolve(dir, `${name}.png`)).catch(() => {});
	const text = await browser
		.execute(
			() => `${document.body.innerText}\n\n--- said ---\n${(window.__erti_said ?? []).join('\n')}`
		)
		.catch((e) => String(e));
	writeFileSync(resolve(dir, `${name}.txt`), text);
}
