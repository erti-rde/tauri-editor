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
	await expect(page.getByRole('searchbox', { name: 'Search your notes' })).toBeVisible();
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

// M1b-5, UX-2
test('a book with no PDF can be entered by hand, and joins the project', async ({ page }) => {
	await launch(page);
	await openProject(page);
	await page.getByRole('button', { name: 'Sources' }).click();
	await expect(page.getByRole('heading', { name: 'Sources (3)' })).toBeVisible();

	// M1b-5 AC-1: kind first, then that kind's fields, the required ones marked.
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await page.getByRole('menuitem', { name: /Enter details…/ }).click();
	const sidebar = page.getByRole('complementary', { name: 'New source' });
	await sidebar.getByRole('button', { name: 'Kind of source' }).click();
	await page.getByRole('option', { name: 'Book', exact: true }).click();
	await sidebar.getByRole('textbox', { name: 'Title (required)' }).fill('Orality and Literacy');
	await sidebar.getByRole('textbox', { name: 'Publisher' }).fill('Methuen');
	await sidebar.getByRole('textbox', { name: 'Date', exact: true }).fill('1982');
	await sidebar.getByRole('button', { name: 'Add a person' }).click();
	await sidebar.getByRole('textbox', { name: 'Family name' }).fill('Ong');
	await sidebar.getByRole('textbox', { name: 'Given names' }).fill('Walter J.');
	await sidebar.getByRole('button', { name: 'Add to library' }).click();

	// M1b-5 AC-2: in the library and this project.
	await expect(
		page.getByText('Added “Orality and Literacy” to your library and this project.')
	).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Sources (4)' })).toBeVisible();
	const row = page.getByRole('button', { name: /^Book Orality and Literacy/ });
	await expect(row).toContainText('Ong, Walter J.');
	// M1b-5 AC-4: beside the row, with the action that gives it one.
	await expect(page.getByText('No file')).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Attach PDF to Orality and Literacy' })
	).toBeAttached();

	const added = await page.evaluate(() =>
		[...window.__ERTI_FAKE__!.state.library.values()].find((s) => s.csl_json?.includes('Orality'))
	);
	expect(added?.sha256).toMatch(/^erti:[0-9a-f-]{36}$/);
	expect(added?.resolved_via).toBe('by-hand');
});

// M1b-6, UX-2
test('a DOI is looked up and added, and one in the library already opens it', async ({ page }) => {
	// doi.org answered here: nothing leaves the machine, and nothing else is asked.
	const asked: string[] = [];
	await page.route(/^https:\/\/(doi\.org|api\.crossref\.org)\//, (route) => {
		const url = route.request().url();
		asked.push(url);
		// Anything else, such as the project's unread scan searched for now that
		// lookups are on, finds nothing citable.
		if (url !== 'https://doi.org/10.1038/nature14539') {
			return route.fulfill({
				headers: { 'access-control-allow-origin': '*' },
				json: { message: { items: [] } }
			});
		}
		return route.fulfill({
			headers: { 'access-control-allow-origin': '*' },
			json: {
				type: 'article-journal',
				title: 'Deep learning',
				DOI: '10.1038/nature14539',
				author: [{ family: 'LeCun', given: 'Yann' }],
				issued: { 'date-parts': [[2015]] },
				reference: [{ key: 'ref1' }]
			}
		});
	});
	await launch(page, '?consent=granted');
	await openProject(page);
	await page.getByRole('button', { name: 'Sources' }).click();
	await expect(page.getByRole('heading', { name: 'Sources (3)' })).toBeVisible();

	// M1b-6 AC-1: looked up at doi.org, then in the library and this project.
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await page.getByRole('menuitem', { name: /From a DOI…/ }).click();
	const dialog = page.getByRole('dialog', { name: 'Add from a DOI' });
	await dialog.getByRole('textbox', { name: 'DOI' }).fill('https://doi.org/10.1038/nature14539');
	await dialog.getByRole('button', { name: 'Look up' }).click();

	await expect(
		page.getByText('Added “Deep learning” to your library and this project.')
	).toBeVisible();
	await expect(dialog).toBeHidden();
	await expect(page.getByRole('heading', { name: 'Sources (4)' })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Paper Deep learning/ })).toContainText('LeCun');
	await expect(page.getByRole('complementary', { name: 'Edit source' })).toBeVisible();
	const added = await page.evaluate(() =>
		[...window.__ERTI_FAKE__!.state.library.values()].find((s) => s.doi?.includes('nature'))
	);
	expect(added).toMatchObject({ doi: '10.1038/nature14539', resolved_via: 'manual' });
	expect(added?.sha256).toMatch(/^erti:[0-9a-f-]{36}$/);
	expect(JSON.parse(added!.csl_json!)).not.toHaveProperty('reference');
	expect(asked.filter((url) => url.includes('nature14539'))).toHaveLength(1);

	// M1b-6 AC-3: the same DOI, in another case, opens it instead of adding it.
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await page.getByRole('menuitem', { name: /From a DOI…/ }).click();
	await dialog.getByRole('textbox', { name: 'DOI' }).fill('10.1038/NATURE14539');
	await dialog.getByRole('textbox', { name: 'DOI' }).press('Enter');
	await expect(page.getByText('“Deep learning” is in this project already.')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Sources (4)' })).toBeVisible();
	expect(asked.filter((url) => url.includes('nature14539'))).toHaveLength(1);
});

// M1b-6 AC-2, UX-2
test('with lookups off, a DOI is entered by hand, filled in', async ({ page }) => {
	const asked: string[] = [];
	page.on('request', (request) => {
		if (/doi\.org|crossref/.test(request.url())) asked.push(request.url());
	});
	await launch(page);
	await openProject(page);
	await page.getByRole('button', { name: 'Sources' }).click();

	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await page.getByRole('menuitem', { name: /From a DOI…/ }).click();
	const dialog = page.getByRole('dialog', { name: 'Add from a DOI' });
	await expect(dialog).toContainText('Online lookups are off.');
	await expect(dialog.getByRole('button', { name: 'Look up' })).toHaveCount(0);
	await dialog.getByRole('textbox', { name: 'DOI' }).fill('doi:10.1038/nature14539');
	await dialog.getByRole('button', { name: 'Enter details' }).click();

	const sidebar = page.getByRole('complementary', { name: 'New source' });
	await expect(sidebar).toContainText('DOI 10.1038/nature14539, with no file');
	await sidebar.getByRole('button', { name: 'Kind of source' }).click();
	await page.getByRole('option', { name: 'Journal Article', exact: true }).click();
	await expect(sidebar.getByRole('textbox', { name: 'DOI', exact: true })).toHaveValue(
		'10.1038/nature14539'
	);
	await sidebar
		.getByRole('textbox', { name: 'Title (required)', exact: true })
		.fill('Deep learning');
	await sidebar.getByRole('textbox', { name: 'Publication Title (required)' }).fill('Nature');
	await sidebar.getByRole('button', { name: 'Add to library' }).click();

	await expect(page.getByRole('heading', { name: 'Sources (4)' })).toBeVisible();
	const added = await page.evaluate(() =>
		[...window.__ERTI_FAKE__!.state.library.values()].find((s) => s.doi?.includes('nature'))
	);
	expect(added).toMatchObject({ doi: '10.1038/nature14539', resolved_via: 'by-hand' });
	expect(asked).toEqual([]);
});

// M1b-7, UX-2 and UX-3
test('a PDF attached to a source is read, and its File tab says where it lives', async ({
	page
}) => {
	await launch(page);
	await openProject(page);
	// A book entered by hand, and two PDFs of it outside the project folder.
	await page.evaluate(() => {
		const fake = window.__ERTI_FAKE__!;
		fake.state.library.set('erti:ong', {
			sha256: 'erti:ong',
			file_name: '',
			path: null,
			csl_json: JSON.stringify({
				type: 'book',
				title: 'Orality and Literacy',
				author: [{ family: 'Ong', given: 'Walter J.' }]
			}),
			zotero_type: 'book',
			doi: null,
			resolved_via: 'by-hand',
			state: 'ready',
			last_error: null
		});
		fake.state.project.add('erti:ong');
		const paper = [...fake.files.keys()].find((p) => p.endsWith('vaswani-2017.pdf'))!;
		for (const name of ['ong-orality.pdf', 'ong-1982-scan.pdf']) {
			fake.files.set(`/fake/home/Downloads/${name}`, fake.files.get(paper)!);
		}
		fake.dialogAnswers.push(
			'/fake/home/Downloads/ong-orality.pdf',
			'/fake/home/Downloads/ong-1982-scan.pdf'
		);
	});

	await page.getByRole('button', { name: 'Sources' }).click();
	await expect(page.getByRole('heading', { name: 'Sources (4)' })).toBeVisible();

	// M1b-7 AC-1: from the row, read as a scan reads it, and the row follows.
	await page.getByRole('button', { name: /^Book Orality and Literacy/ }).hover();
	await page.getByRole('button', { name: 'Attach PDF to Orality and Literacy' }).click();
	await expect(page.getByText('ong-orality.pdf processed successfully')).toBeVisible();
	await expect(page.getByText('ong-orality.pdf', { exact: true })).toBeVisible();
	await expect(page.getByText('· Reading…')).toHaveCount(0);
	// The file is the book, not a fifth source.
	await expect(page.getByRole('heading', { name: 'Sources (4)' })).toBeVisible();
	const aliases = await page.evaluate(() =>
		Object.fromEntries(window.__ERTI_FAKE__!.state.aliases)
	);
	expect(Object.values(aliases)).toContain('erti:ong');

	// M1b-7 AC-3: where it lives, with Show in folder.
	await page.getByRole('button', { name: /^Book Orality and Literacy/ }).click();
	const sidebar = page.getByRole('complementary', { name: 'Edit source' });
	await sidebar.getByRole('tab', { name: 'File' }).click();
	await expect(sidebar.getByText('/fake/home/Downloads/ong-orality.pdf')).toBeVisible();
	await sidebar.getByRole('button', { name: 'Show in folder' }).click();
	await expect
		.poll(() => page.evaluate(() => window.__ERTI_FAKE__!.opened))
		.toContain('/fake/home/Downloads/ong-orality.pdf');

	// M1b-7 AC-2: a second file of the same work.
	await sidebar.getByRole('button', { name: 'Attach another…' }).click();
	await expect(sidebar.getByText('/fake/home/Downloads/ong-1982-scan.pdf')).toBeVisible();
	await expect(sidebar.getByRole('button', { name: 'Open' })).toHaveCount(2);
	await expect(page.getByRole('heading', { name: 'Sources (4)' })).toBeVisible();

	// M1b-7 AC-3: Open shows it in a tab, leaving the Sources view.
	await sidebar
		.getByRole('listitem')
		.filter({ hasText: 'ong-orality.pdf' })
		.getByRole('button', { name: 'Open' })
		.click();
	await expect(page.getByRole('heading', { name: /Sources/ })).toHaveCount(0);
	await expect(page.getByRole('tab', { name: /ong-orality\.pdf/ })).toBeVisible();
});

// M1b-4, UX-4
test('removing a source asks first, and its citations then render from the manuscript', async ({
	page
}) => {
	await launch(page);
	await openProject(page);
	await openManuscript(page);

	// Chapter 1 is from before 1.0, so it carries no copy of what it cites:
	// removal has to give it one first, or its citation turns into an error.
	const chapter = () =>
		page.evaluate(() => {
			const files = window.__ERTI_FAKE__!.files;
			const path = [...files.keys()].find((p) => p.endsWith('Chapter 1.erti.json'))!;
			return { text: files.get(path) as string, backup: files.has(`${path}.format0.bak`) };
		});
	expect((await chapter()).text).not.toContain('"erti"');

	await page.getByRole('button', { name: 'Sources' }).click();
	await page.getByRole('button', { name: /Attention Is All You Need/ }).click();
	const sidebar = page.getByRole('complementary', { name: 'Edit source' });
	await sidebar.getByRole('button', { name: 'Remove from library…' }).click();

	// M1b-4 AC-1: what it touches, before anything happens.
	const dialog = page.getByRole('dialog', {
		name: 'Remove “Attention Is All You Need” from your library?'
	});
	await expect(dialog).toContainText('Cited 1 time in Chapter 1 in this project.');
	await expect(dialog).toContainText(/\d+ highlights? will be deleted\./);
	await expect(dialog).toContainText('It’s in this project’s folder');
	await dialog.getByRole('button', { name: 'Remove' }).click();

	// M1b-4 AC-4
	await expect(
		page.getByText('Removed. You can restore it from a library backup in Settings › Library.')
	).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Sources (2)' })).toBeVisible();
	await expect(sidebar).toBeHidden();

	// M1b-4 AC-2: its marks went with it.
	await page.getByRole('button', { name: 'Notes' }).click();
	await expect(page.getByText('· vaswani-2017.pdf')).toHaveCount(0);

	// M1b-4 AC-3: dotted, from the chapter's own copy, not an error. The copy
	// was written by the removal, with the pre-1.0 file kept beside it.
	const carried = await chapter();
	expect(JSON.parse(carried.text).erti.format).toBe(1);
	expect(carried.backup).toBe(true);
	// The chapter is still open in its tab, and is read again as the editor returns.
	await page.getByRole('button', { name: 'Files' }).click();
	await expect(page.locator('.ProseMirror')).toContainText('Attention in Low-Resource Translation');
	const away = page.locator('.ProseMirror [data-type="citation"][data-away]');
	await expect(away).toContainText('Vaswani');
});

// After M1b-4 (#222): a reader left open on a removed source would go on
// offering to save marks the library can no longer take.
test('removing a source closes its PDF, and leaves the manuscript open', async ({ page }) => {
	await launch(page);
	await openProject(page);
	await openManuscript(page);

	await page.getByText('papers', { exact: true }).click();
	await page.getByText('vaswani-2017.pdf').click();
	await expect(page.getByText('Sample Paper for the Erti Harness').first()).toBeVisible();
	const tabs = page.getByRole('tablist', { name: 'Open files' });
	await expect(tabs.getByRole('tab', { name: /^vaswani-2017/ })).toBeVisible();

	await page.getByRole('button', { name: 'Sources' }).click();
	await page.getByRole('button', { name: /Attention Is All You Need/ }).click();
	await page.getByRole('button', { name: 'Remove from library…' }).click();
	await page
		.getByRole('dialog', { name: /^Remove “Attention/ })
		.getByRole('button', { name: 'Remove' })
		.click();
	await expect(page.getByRole('heading', { name: 'Sources (2)' })).toBeVisible();

	await page.getByRole('button', { name: 'Files' }).click();
	await expect(tabs.getByRole('tab', { name: /^vaswani-2017/ })).toHaveCount(0);
	await expect(page.getByText('Sample Paper for the Erti Harness')).toHaveCount(0);
	await expect(tabs.getByRole('tab', { name: /Chapter 1/ })).toBeVisible();
	await expect(page.locator('.ProseMirror')).toContainText('Attention in Low-Resource Translation');
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

test('a note on a source is written in its Notes tab, beside the marks on its PDF', async ({
	page
}) => {
	await launch(page);
	await openProject(page);
	await page.getByRole('button', { name: 'Sources' }).click();
	await page.getByRole('button', { name: /Attention Is All You Need/ }).click();
	const sidebar = page.getByRole('complementary', { name: 'Edit source' });

	// M1b-8 AC-1: the marks made in its PDF are counted and listed.
	await sidebar.getByRole('tab', { name: 'Notes (2)' }).click();
	const marks = sidebar.getByRole('region', { name: 'Marked in the PDF' });
	await expect(marks.getByRole('listitem')).toHaveCount(2);

	// M1b-8 AC-2: note, quote, page and label, saved with ⌘↩.
	await sidebar.getByRole('button', { name: 'New note' }).click();
	const form = sidebar.getByRole('form', { name: 'New note' });
	await form.getByRole('textbox', { name: /^Note/ }).fill('Attention replaces recurrence.');
	await form
		.getByRole('textbox', { name: /^Quote/ })
		.fill('dispensing with recurrence and convolutions entirely');
	await form.getByRole('textbox', { name: /^Page/ }).fill('1');
	await form.getByRole('button', { name: 'Label' }).click();
	await page.getByRole('option', { name: 'Evidence' }).click();
	await form.getByRole('textbox', { name: /^Page/ }).press('ControlOrMeta+Enter');

	await expect(form).toHaveCount(0);
	await expect(sidebar.getByRole('tab', { name: 'Notes (3)' })).toBeVisible();
	const note = sidebar.getByRole('list', { name: 'Notes' }).getByRole('listitem');
	await expect(note).toContainText('Evidence');
	await expect(note).toContainText('p. 1');
	await expect(note).toContainText('Attention replaces recurrence.');
	const kept = await page.evaluate(() => [...window.__ERTI_FAKE__!.state.sourceNotes.values()]);
	expect(kept).toEqual([
		expect.objectContaining({
			body: 'Attention replaces recurrence.',
			quote: 'dispensing with recurrence and convolutions entirely',
			page_label: '1',
			label_id: 'evidence'
		})
	]);

	// Changed, then deleted once asked.
	await note.getByRole('button', { name: 'Edit' }).click();
	const editing = sidebar.getByRole('form', { name: 'Change the note' });
	await editing.getByRole('textbox', { name: /^Note/ }).fill('Recurrence, gone.');
	await editing.getByRole('button', { name: 'Save' }).click();
	await expect(note).toContainText('Recurrence, gone.');
	await note.getByRole('button', { name: 'Edit' }).click();
	await sidebar.getByRole('button', { name: 'Delete' }).click();
	await page
		.getByRole('dialog', { name: 'Delete this note?' })
		.getByRole('button', { name: 'Delete' })
		.click();
	await expect(sidebar.getByRole('tab', { name: 'Notes (2)' })).toBeVisible();
});

// M1b-8 AC-3: from the Sources view, where the editor isn't, to the place the
// writer left off in the manuscript.
test('a note with a page cites its source at that page, where the writer left off', async ({
	page
}) => {
	await launch(page);
	await openProject(page);
	await openManuscript(page);
	// The cursor at the start of the opening paragraph, not the end the editor opens at.
	const opening = page.locator('.ProseMirror p').first();
	await opening.click({ position: { x: 2, y: 2 } });
	await page.keyboard.press('Home');

	await page.getByRole('button', { name: 'Sources' }).click();
	await page.getByRole('button', { name: /Attention Is All You Need/ }).click();
	const sidebar = page.getByRole('complementary', { name: 'Edit source' });
	await sidebar.getByRole('tab', { name: /^Notes/ }).click();
	await sidebar.getByRole('button', { name: 'New note' }).click();
	await sidebar.getByRole('textbox', { name: /^Note/ }).fill('Eight heads.');
	await sidebar.getByRole('textbox', { name: /^Page/ }).fill('3');
	await sidebar.getByRole('textbox', { name: /^Page/ }).press('ControlOrMeta+Enter');

	await sidebar.getByRole('button', { name: 'Cite with p. 3' }).click();

	await expect(opening).toContainText('(Vaswani, 2017, p. 3) Sequence models built on recurrence');
	await expect(page.getByRole('heading', { name: /^Sources/ })).toHaveCount(0);
	// And the cursor after it, so the next words follow the citation: the
	// editor's own focus, a tick after it opens, once put the cursor back.
	await page.keyboard.type('Next.');
	await expect(opening).toContainText('(Vaswani, 2017, p. 3) Next.');

	// Kept in the file as the page, beside the work, not only as the words shown.
	const cited = () =>
		page.evaluate(() => {
			const files = window.__ERTI_FAKE__!.files;
			const path = [...files.keys()].find((p) => p.endsWith('Chapter 1.erti.json'))!;
			const opening = JSON.parse(files.get(path) as string).content[2].content;
			return opening.find((node: { type: string }) => node.type === 'citation').attrs;
		});
	await expect.poll(async () => (await cited()).locators).toBeTruthy();
	const { id, locators } = await cited();
	expect(Object.values(locators)).toEqual(['3']);
	expect(JSON.parse(id)).toEqual(Object.keys(locators));
});

test('a note on a source is found in the Notes panel, by its words and by its meaning', async ({
	page
}) => {
	await launch(page);
	await openProject(page);
	await openManuscript(page);

	await page.getByRole('button', { name: 'Sources' }).click();
	await page.getByRole('button', { name: /Attention Is All You Need/ }).click();
	const sidebar = page.getByRole('complementary', { name: 'Edit source' });
	await sidebar.getByRole('tab', { name: /^Notes/ }).click();
	await sidebar.getByRole('button', { name: 'New note' }).click();
	await sidebar
		.getByRole('textbox', { name: /^Note/ })
		.fill('Heads attend to positions jointly, which recurrence cannot.');
	await sidebar.getByRole('textbox', { name: /^Page/ }).fill('4');
	await sidebar.getByRole('textbox', { name: /^Page/ }).press('ControlOrMeta+Enter');
	await expect(sidebar.getByRole('button', { name: 'Cite with p. 4' })).toBeVisible();

	await page.getByRole('button', { name: 'Notes', exact: true }).click();
	const search = page.getByRole('searchbox', { name: 'Search your notes' });
	await search.fill('recurrence cannot');
	await search.press('Enter');
	const found = page.getByText('Heads attend to positions jointly, which recurrence cannot.');
	await expect(found).toBeVisible();
	await expect(page.getByText('· Attention Is All You Need')).toBeVisible();
	await expect(page.getByText('· p. 4', { exact: true })).toBeVisible();

	// By meaning, which only finds it if saving the note prepared it.
	await search.fill('positions jointly');
	await page.getByRole('radio', { name: 'Meaning' }).click();
	await expect(found).toBeVisible();
	await expect(page.getByText('Nothing found by meaning.')).toHaveCount(0);
});
