import { expect, launch, openManuscript, openProject, test } from './harness';

/**
 * Screenshots for PRs (M1a-1 AC-5): `pnpm e2e:shots` writes them to
 * `e2e/shots/`. Skipped in an ordinary run, where they would only cost time.
 */
test.skip(!process.env.ERTI_SHOTS, 'screenshots are taken by `pnpm e2e:shots`');

const shot = (name: string) => ({ path: `e2e/shots/${name}.png` });

test('shots', async ({ page }) => {
	await launch(page, '?consent=unasked');
	await expect(
		page.getByRole('dialog', { name: 'Look up citation details online?' })
	).toBeVisible();
	await page.screenshot(shot('01-consent'));
	await page.getByRole('button', { name: 'Stay offline' }).click();

	await page.screenshot(shot('02-landing'));

	await openProject(page);
	await openManuscript(page);
	await page.screenshot(shot('03-editor'));

	await page.getByRole('button', { name: 'Outline' }).click();
	await page.screenshot(shot('04-outline'));

	await page.getByRole('button', { name: 'Notes' }).click();
	await expect(page.getByText('Core claim; contrast with the RNN section')).toBeVisible();
	await page.screenshot(shot('05-notes'));

	await page.getByRole('button', { name: 'Sources' }).click();
	await page.screenshot(shot('06-sources'));

	await page.getByRole('button', { name: 'Files' }).click();
	await page.getByText('papers', { exact: true }).click();
	await page.getByText('vaswani-2017.pdf').click();
	await expect(page.getByText('Sample Paper for the Erti Harness').first()).toBeVisible();
	await page.screenshot(shot('07-reader'));

	// Back to the manuscript, whose document bar switches chapters.
	await page.getByText('Chapter 1.erti.json').locator('visible=true').first().click();
	await page.getByRole('button', { name: 'Shared chapter', exact: true }).click();
	const away = page.locator('.ProseMirror [data-type="citation"][data-away]');
	await away.hover();
	await expect(page.getByRole('dialog', { name: 'Source from the manuscript' })).toBeVisible();
	await page.screenshot(shot('08-away-citation'));

	await page.getByRole('button', { name: 'Settings' }).click();
	await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
	await page.screenshot(shot('09-settings'));
});
