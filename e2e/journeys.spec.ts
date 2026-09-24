import { expect, launch, openManuscript, openProject, test } from './harness';

test('a first launch asks before anything is looked up online', async ({ page }) => {
	await launch(page, '?consent=unasked');

	const prompt = page.getByRole('dialog', { name: 'Look up citation details online?' });
	await expect(prompt).toBeVisible();
	await prompt.getByRole('button', { name: 'Stay offline' }).click();

	await expect(prompt).toBeHidden();
	await expect(page.getByRole('button', { name: /^Thesis/ })).toBeVisible();
});

test('open a project, then its manuscript', async ({ page }) => {
	await launch(page);
	await openProject(page);
	await openManuscript(page);

	// The word count and save state are read from the document, so they prove
	// it loaded rather than merely that the editor mounted.
	await expect(page.getByText('Saved')).toBeVisible();
});

// M1a-1 AC-4, for M0-3: nothing is stored, and the editor still mounts and
// cites, in the bundled default style.
test('with no citation style stored, the editor mounts and cites', async ({ page }) => {
	await launch(page);
	await openProject(page);
	await openManuscript(page);

	await expect(page.locator('.ProseMirror')).toContainText('(Vaswani, 2017)');
	const fake = await page.evaluate(() => [
		...(window.__ERTI_FAKE__?.stores.get('settings-store.json')?.keys() ?? [])
	]);
	expect(fake).not.toContain('cslXml');
});

test('each rail panel opens', async ({ page }) => {
	await launch(page);
	await openProject(page);
	await openManuscript(page);

	await page.getByRole('button', { name: 'Outline' }).click();
	await expect(page.getByRole('navigation', { name: 'Document outline' })).toContainText(
		'Introduction'
	);

	await page.getByRole('button', { name: 'Notes' }).click();
	await expect(page.getByRole('textbox', { name: 'Search your notes' })).toBeVisible();
	await expect(page.getByText('Core claim; contrast with the RNN section')).toBeVisible();

	await page.getByRole('button', { name: 'Sources' }).click();
	await expect(page.getByRole('heading', { name: 'Sources (3)' })).toBeVisible();

	await page.getByRole('button', { name: 'Files' }).click();
	await expect(page.getByText('papers')).toBeVisible();
});

test('settings open and close', async ({ page }) => {
	await launch(page);
	await openProject(page);

	await page.getByRole('button', { name: 'Settings' }).click();
	const settings = page.getByRole('dialog', { name: 'Settings' });
	await expect(settings).toBeVisible();

	for (const tab of ['Citations', 'Reading', 'Page setup', 'Appearance', 'General']) {
		await settings.getByRole('tab', { name: tab }).click();
		await expect(settings.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
	}

	await settings.getByRole('button', { name: 'Close settings' }).click();
	await expect(settings).toBeHidden();
});
