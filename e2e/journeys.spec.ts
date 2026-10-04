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
	// Each mark names its paper.
	await expect(page.getByText('· vaswani-2017.pdf').first()).toBeVisible();
	await expect(page.getByText('unknown paper')).toHaveCount(0);

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

// M1a-12 AC-5
test('the log folder opens from Settings', async ({ page }) => {
	await launch(page);
	await openProject(page);

	await page.getByRole('button', { name: 'Settings' }).click();
	const settings = page.getByRole('dialog', { name: 'Settings' });
	await settings.getByRole('button', { name: 'Open log folder' }).click();

	await expect
		.poll(() => page.evaluate(() => window.__ERTI_FAKE__!.calls.map((c) => c.cmd)))
		.toContain('open_log_folder');
});

// M1a-12 AC-3
test('an error nothing caught is said once, and logged', async ({ page, errors }) => {
	// Thrown on purpose, so not the journey's failure.
	errors.expected.push(/The outline lost its place/);
	await launch(page);
	await openProject(page);

	// Thrown twice from outside any handler, as a bug in a redraw would be.
	await page.evaluate(() => {
		for (let i = 0; i < 2; i++) {
			setTimeout(() => {
				throw new Error('The outline lost its place');
			});
		}
	});

	const toast = page.getByText(
		'Something went wrong: The outline lost its place. Details are in the log.'
	);
	await expect(toast).toHaveCount(1);
	const logged = () =>
		page.evaluate(() =>
			window.__ERTI_FAKE__!.logs.filter((l) => l.message.includes('The outline lost its place'))
		);
	await expect.poll(async () => (await logged()).length).toBe(1);
	expect((await logged())[0].message).toMatch(/^Uncaught error: Error: The outline lost its place/);
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

// M1a-8 AC-4: read-only belongs to the file from a newer Erti, not to whatever
// is opened after it. A new document once stayed read-only under that file's
// banner.
test('a new document after one from a newer Erti can be written in', async ({ page }) => {
	await launch(page);
	await page.waitForFunction(() => window.__ERTI_FAKE__ !== undefined);
	await page.evaluate(() => {
		const files = window.__ERTI_FAKE__!.files;
		const chapter = [...files.keys()].find((p) => p.endsWith('/Chapter 1.erti.json'))!;
		const away = 'e'.repeat(64);
		files.set(
			chapter.replace('Chapter 1', 'Future chapter'),
			JSON.stringify({
				type: 'doc',
				content: [
					{
						type: 'paragraph',
						content: [
							{ type: 'text', text: 'Written later ' },
							{ type: 'citation', attrs: { id: JSON.stringify([away]) } }
						]
					}
				],
				erti: {
					format: 99,
					savedWith: '9.0.0',
					sources: {
						[away]: { id: away, type: 'book', title: 'Later', author: [{ family: 'Later' }] }
					}
				}
			})
		);
	});
	await openProject(page);
	await openManuscript(page);

	await page.getByRole('button', { name: 'Future chapter', exact: true }).click();
	const banner = page.getByText('This document was saved by a newer Erti.');
	await expect(banner).toBeVisible();
	await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');

	await page.getByRole('button', { name: '+ New' }).click();
	await page.getByRole('textbox', { name: 'Name for the new document' }).fill('Chapter two');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('button', { name: 'Chapter two', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);

	await expect(banner).toBeHidden();
	const editor = page.locator('.ProseMirror');
	await expect(editor).toHaveAttribute('contenteditable', 'true');
	await editor.click();
	await page.keyboard.type('A fresh start.');
	await expect(editor).toContainText('A fresh start.');
});

// M1c-2 AC-1, AC-3: the Menu primitive, open in a real browser. jsdom can't
// position it, so its component test can't see it on screen.
test('the text-style menu opens from the keyboard and makes a heading', async ({ page }) => {
	await launch(page);
	await openProject(page);
	await openManuscript(page);

	// Whichever paragraph the cursor ends up in: under load the document can
	// still be settling when the click lands, and the menu is what's tested.
	const headings = page.locator('.ProseMirror h2');
	await expect(headings).toHaveCount(1);
	await page.locator('.ProseMirror p').first().click();
	await page.getByRole('button', { name: 'Text style' }).focus();
	await page.keyboard.press('Enter');
	const menu = page.getByRole('menu');
	await expect(menu).toBeVisible();
	await expect(menu.getByRole('menuitem')).toHaveText(['Heading 1', 'Heading 2', 'Heading 3']);

	await menu.getByRole('menuitem', { name: 'Heading 2' }).click();
	await expect(menu).toBeHidden();
	await expect(headings).toHaveCount(2);
});

// M1c-3 AC-2, AC-3: Settings on the Dialog primitive. The trap measures what's
// tabbable, which only a browser with layout can show.
test('Settings keeps focus inside, and Escape gives it back to the Settings button', async ({
	page
}) => {
	await launch(page);
	await openProject(page);

	const opener = page.getByRole('button', { name: 'Settings' });
	await opener.click();
	const dialog = page.getByRole('dialog', { name: 'Settings' });
	await expect(dialog).toBeVisible();

	for (let i = 0; i < 40; i++) {
		await page.keyboard.press('Tab');
		const inside = await dialog.evaluate((node) => node.contains(document.activeElement));
		expect(inside, `Tab ${i + 1} left the dialog`).toBe(true);
	}

	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(opener).toBeFocused();
});
