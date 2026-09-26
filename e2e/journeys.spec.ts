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

// M1a-8 AC-6, UX-12
test('a co-author’s citation renders from the manuscript, and can be kept', async ({ page }) => {
	await launch(page);
	await openProject(page);
	await openManuscript(page);
	// Chapters switch from the document bar.
	await page.getByRole('button', { name: 'Shared chapter', exact: true }).click();

	// Rendered from the file's own sources, dotted, not an error.
	const away = page.locator('.ProseMirror [data-type="citation"][data-away]');
	await expect(away).toContainText('Kuhn');

	await away.hover();
	const tip = page.getByRole('dialog', { name: 'Source from the manuscript' });
	await expect(tip).toContainText('From the manuscript: not in your library');
	await tip.getByRole('button', { name: 'Add to library' }).click();

	// Now the library's own, so no longer marked.
	await expect(page.getByText('Added to your library.')).toBeVisible();
	await expect(away).toHaveCount(0);
	await expect(page.locator('.ProseMirror [data-type="citation"]')).toContainText('Kuhn');
});

// M1a-8 AC-1, AC-7
test('saving a chapter from before 1.0 upgrades it, and keeps the old file beside it', async ({
	page
}) => {
	await launch(page);
	await openProject(page);
	await openManuscript(page);

	await page.locator('.ProseMirror').click();
	await page.keyboard.press('End');
	await page.keyboard.type(' More.');

	// "Saved" shows before the edit too; wait for the file itself to change.
	await expect
		.poll(() =>
			page.evaluate(() => {
				const files = window.__ERTI_FAKE__!.files;
				const path = [...files.keys()].find((p) => p.endsWith('Chapter 1.erti.json'))!;
				return (files.get(path) as string).includes('"erti"');
			})
		)
		.toBe(true);

	const written = await page.evaluate(() => {
		const files = window.__ERTI_FAKE__!.files;
		const path = [...files.keys()].find((p) => p.endsWith('Chapter 1.erti.json'))!;
		return {
			file: JSON.parse(files.get(path) as string),
			backup: files.has(`${path}.format0.bak`)
		};
	});
	expect(written.file.type).toBe('doc');
	expect(written.file.erti.format).toBe(1);
	// The one work Chapter 1 cites travels with it.
	expect(Object.keys(written.file.erti.sources)).toHaveLength(1);
	expect(written.backup).toBe(true);
});

// Opening isn't citing: a manuscript without a reference list keeps it that
// way, however long it's open. An update fired while the editor was being set
// up once looked like the first citation arriving, and brought one in.
test('opening a manuscript with no reference list leaves it without one', async ({ page }) => {
	await launch(page);
	await openProject(page);
	await openManuscript(page);

	await expect(page.locator('.ProseMirror')).toContainText('(Vaswani, 2017)');
	// Past the project's scan too, which reloads the sources and re-renders.
	await expect(page.getByText('scan-chapter.pdf processed successfully')).toBeVisible();
	await page.waitForTimeout(500);
	await expect(page.locator('.ProseMirror [data-type="bibliography"]')).toHaveCount(0);
});
