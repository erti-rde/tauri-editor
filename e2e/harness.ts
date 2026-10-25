import { expect, test as base, type Page } from '@playwright/test';

/**
 * The page every journey starts from, with the checks every journey ends with.
 *
 * A console error, an error written to the log, or an uncaught exception fails
 * the journey even when every assertion passed: the bugs this harness exists
 * for are the ones that break something without breaking the step being looked
 * at. So does a command the fake backend was never taught, which would
 * otherwise pass as `undefined`.
 *
 * The log counts as well as the console because the journeys run on a
 * production build, where `log.*` writes only to the log (M1a-12): a caught
 * failure that used to reach the console now reaches only the fake's `logs`.
 */
export const test = base.extend<{ errors: string[] & { expected: RegExp[] } }>({
	errors: [
		async ({ page }, use) => {
			// A journey that throws on purpose names what it throws in `expected`.
			const errors = Object.assign([] as string[], { expected: [] as RegExp[] });
			page.on('console', (message) => {
				if (message.type() === 'error') errors.push(message.text());
			});
			page.on('pageerror', (error) => errors.push(error.message));

			await use(errors);

			const unhandled = await page
				.evaluate(() => window.__ERTI_FAKE__?.unhandled ?? [])
				.catch(() => []);
			expect(unhandled, 'commands the fake backend has no handler for').toEqual([]);
			// tauri-plugin-log's `LogLevel.Error`.
			const logged = await page
				.evaluate(() => (window.__ERTI_FAKE__?.logs ?? []).filter((l) => l.level >= 5))
				.catch(() => []);
			const unexpected = [...errors, ...logged.map((l) => l.message)].filter(
				(e) => !errors.expected.some((pattern) => pattern.test(e))
			);
			expect(unexpected, 'errors logged or shown in the console during the journey').toEqual([]);
		},
		{ auto: true }
	]
});

export { expect };

/** Boot the app. `query` picks a world: see `src/lib/harness/boot.ts`. */
export async function launch(page: Page, query = '') {
	await page.goto(`/harness${query}`);
}

/** From the landing screen into the fixture project. */
export async function openProject(page: Page) {
	await page.getByRole('button', { name: /^Thesis/ }).click();
	await expect(page.getByText('Chapter 1.erti.json')).toBeVisible();
}

/** Open the fixture's chapter in the editor. */
export async function openManuscript(page: Page) {
	await page.getByText('Chapter 1.erti.json').click();
	await expect(page.locator('.ProseMirror')).toContainText('Attention in Low-Resource Translation');
}

/** A manuscript's tab in the document bar, above the toolbar. */
export function documentTab(page: Page, title: string) {
	return page
		.getByRole('tablist', { name: 'Documents' })
		.getByRole('tab', { name: title, exact: true });
}

/**
 * Replace one word of a manuscript paragraph, as the writer would: a double
 * click on the word, wherever it is on screen, then typing. Measured rather
 * than clicked by offset, since a split pane can scroll the page's left edge
 * out of view.
 */
export async function replaceWord(
	page: Page,
	paragraph: string,
	word: string,
	replacement: string
) {
	const at = await page.evaluate(
		([paragraph, word]) => {
			const p = [...document.querySelectorAll('.ProseMirror p')].find((e) =>
				e.textContent?.includes(paragraph)
			);
			const walker = p && document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
			for (let node = walker?.nextNode(); node; node = walker!.nextNode()) {
				const i = node.textContent!.indexOf(word);
				if (i < 0) continue;
				const range = document.createRange();
				range.setStart(node, i);
				range.setEnd(node, i + word.length);
				const box = range.getBoundingClientRect();
				return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
			}
			return null;
		},
		[paragraph, word]
	);
	if (!at) throw new Error(`No “${word}” in the paragraph “${paragraph}”.`);
	await page.mouse.dblclick(at.x, at.y);
	await page.keyboard.type(replacement);
}

/**
 * Put the caret at the end of a manuscript paragraph. Not End: on macOS that
 * scrolls the page and leaves the caret where the click put it, so a journey
 * typed mid-word there and at the end on Linux.
 */
export async function caretAtEnd(page: Page, paragraph: string) {
	const p = page.locator('.ProseMirror p', { hasText: paragraph });
	await p.click();
	await p.evaluate((element) => {
		const range = document.createRange();
		range.selectNodeContents(element);
		range.collapse(false);
		getSelection()?.removeAllRanges();
		getSelection()?.addRange(range);
	});
	return p;
}
