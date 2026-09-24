import { expect, test as base, type Page } from '@playwright/test';

/**
 * The page every journey starts from, with the checks every journey ends with.
 *
 * A console error or an uncaught exception fails the journey even when every
 * assertion passed: the bugs this harness exists for are the ones that break
 * something without breaking the step being looked at. So does a command the
 * fake backend was never taught, which would otherwise pass as `undefined`.
 */
export const test = base.extend<{ errors: string[] }>({
	errors: [
		async ({ page }, use) => {
			const errors: string[] = [];
			page.on('console', (message) => {
				if (message.type() === 'error') errors.push(message.text());
			});
			page.on('pageerror', (error) => errors.push(error.message));

			await use(errors);

			const unhandled = await page
				.evaluate(() => window.__ERTI_FAKE__?.unhandled ?? [])
				.catch(() => []);
			expect(unhandled, 'commands the fake backend has no handler for').toEqual([]);
			expect(errors, 'console errors during the journey').toEqual([]);
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
