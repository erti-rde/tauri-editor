import { expect, launch, openManuscript, openProject, replaceWord, test } from './harness';

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

	// Following, the panel lists what's close to the paragraph the cursor is
	// in (M3-5), so the cursor goes to the one the marks are about.
	await page.locator('.ProseMirror p', { hasText: 'Sequence models built on recurrence' }).click();
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
	// M3-4: whether the reading reaches into the writing, above the labels.
	await page.getByRole('tab', { name: 'Reading' }).click();
	await expect(page.getByRole('switch', { name: 'Follow my writing' })).toBeChecked();
	await page.screenshot(shot('22-settings-reading'));
	await page.keyboard.press('Escape');

	// Asked before, never undone by accident (UX-4). Cancelled: later shots
	// keep the source.
	await page.getByRole('button', { name: 'Sources' }).click();
	await page.getByRole('button', { name: /Attention Is All You Need/ }).click();
	await page.screenshot(shot('10-source-sidebar'));
	await page.getByRole('button', { name: 'Remove from library…' }).click();
	const remove = page.getByRole('dialog', { name: /^Remove “Attention/ });
	await expect(remove).toBeVisible();
	await page.screenshot(shot('11-remove-source'));
	await remove.getByRole('button', { name: 'Cancel' }).click();

	// Entered by hand (UX-2): the kind first, then its fields.
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await page.getByRole('menuitem', { name: /Enter details…/ }).click();
	await page.getByRole('button', { name: 'Kind of source' }).click();
	await page.getByRole('option', { name: 'Book Section', exact: true }).click();
	await page.screenshot(shot('12-new-source'));

	// No file, and the action that attaches one on hover (UX-2).
	const form = page.getByRole('complementary', { name: 'New source' });
	await form
		.getByRole('textbox', { name: 'Title (required)', exact: true })
		.fill('The Ethnographic Present');
	await form.getByRole('textbox', { name: 'Book Title (required)' }).fill('Writing Culture');
	await form.getByRole('button', { name: 'Add to library' }).click();
	await page.getByRole('button', { name: /^Chapter The Ethnographic Present/ }).hover();
	await expect(
		page.getByRole('button', { name: 'Attach PDF to The Ethnographic Present' })
	).toBeVisible();
	await page.screenshot(shot('13-attach-pdf'));

	// A source's files, where each lives (UX-3).
	await page.getByRole('button', { name: /Attention Is All You Need/ }).click();
	await page.getByRole('tab', { name: 'File' }).click();
	await expect(page.getByRole('tab', { name: 'File' })).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByRole('button', { name: 'Show in folder' })).toBeVisible();
	// Finished, not mid-way through the tab's 120ms change of colour.
	await page.screenshot({ ...shot('14-source-files'), animations: 'disabled' });

	// From a DOI, with lookups off (UX-2): it says so, and offers the details.
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await page.getByRole('menuitem', { name: /From a DOI…/ }).click();
	const fromDoi = page.getByRole('dialog', { name: 'Add from a DOI' });
	await fromDoi.getByRole('textbox', { name: 'DOI' }).fill('10.1038/nature14539');
	await expect(fromDoi.getByRole('button', { name: 'Enter details' })).toBeEnabled();
	await page.screenshot({ ...shot('15-from-doi'), animations: 'disabled' });
	await page.keyboard.press('Escape');
	await expect(fromDoi).toBeHidden();

	// Importing a bibliography: the preview before anything is written (UX-6)…
	await page.evaluate(() => {
		const fake = window.__ERTI_FAKE__!;
		fake.files.set(
			'/fake/home/Zotero/library.bib',
			[
				'@inproceedings{vaswani2017, title = {Attention is all you need}, author = {Vaswani, Ashish}, year = {2017}}',
				'@book{ong1982, title = {Orality and Literacy}, author = {Ong, Walter J.}, year = {1982}, file = {:/Users/ako/Zotero/storage/AB12/Ong - 1982 - Orality and Literacy.pdf:PDF}}',
				'@article{lecun2015, title = {Deep learning}, author = {LeCun, Yann}, journal = {Nature}, year = {2015}, file = {:/Users/ako/Zotero/storage/CD34/LeCun et al. - 2015 - Deep learning.pdf:PDF}}',
				'@misc{notes, author = {Nobody}, year = {2001}}'
			].join('\n\n')
		);
		fake.dialogAnswers.push('/fake/home/Zotero/library.bib');
	});
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await page.getByRole('menuitem', { name: /Import a bibliography…/ }).click();
	const importing = page.getByRole('dialog', { name: 'Import library.bib' });
	await expect(importing.getByRole('button', { name: 'Import 2' })).toBeEnabled();
	await expect(importing.getByRole('button', { name: 'Choose folder…' })).toBeVisible();
	await page.screenshot({ ...shot('20-import-preview'), animations: 'disabled' });

	// …and what it added, until the filter is cleared.
	await importing.getByRole('checkbox', { name: 'Also add them to this project' }).click();
	await importing.getByRole('button', { name: 'Import 2' }).click();
	await expect(page.getByText('Imported just now')).toBeVisible();
	await page.screenshot({ ...shot('21-imported-just-now'), animations: 'disabled' });
	await page.getByRole('button', { name: 'Clear filter' }).click();

	// A source's notes, with one being written, above the marks in its PDF (UX-3).
	await page.getByRole('tab', { name: /^Notes/ }).click();
	await page.getByRole('button', { name: 'New note' }).click();
	await page.getByRole('textbox', { name: /^Note/ }).fill('The contrast I need for §3.');
	await page
		.getByRole('textbox', { name: /^Quote/ })
		.fill('dispensing with recurrence and convolutions entirely');
	await page.getByRole('textbox', { name: /^Page/ }).fill('1');
	await page.screenshot({ ...shot('16-source-notes'), animations: 'disabled' });

	// Saved, it offers to cite the paper at its page (M1b-8 AC-3)…
	await page.getByRole('textbox', { name: /^Page/ }).press('ControlOrMeta+Enter');
	const citeIt = page.getByRole('button', { name: 'Cite with p. 1' });
	await expect(citeIt).toBeVisible();
	await page.screenshot({ ...shot('17-cite-with-page'), animations: 'disabled' });

	// …which goes in where the writer left off in the manuscript.
	await citeIt.click();
	await expect(page.locator('.ProseMirror')).toContainText('(Vaswani, 2017, p. 1)');
	await page.screenshot({ ...shot('18-cited-at-page'), animations: 'disabled' });

	// And the note is found in the Notes panel with the marks (M1b-8 AC-4).
	await page.getByRole('button', { name: 'Notes', exact: true }).click();
	const search = page.getByRole('searchbox', { name: 'Search your notes' });
	await search.fill('contrast');
	await search.press('Enter');
	await expect(page.getByText('The contrast I need for §3.')).toBeVisible();
	await page.screenshot({ ...shot('19-notes-find-source-note'), animations: 'disabled' });
});

// M3-5: two of the Notes panel's states, in their own words.
test('shots of the Notes panel saying what happened', async ({ page }) => {
	await launch(page);
	await openProject(page);

	await page.getByRole('button', { name: 'Notes' }).click();
	await expect(page.getByText(/^No manuscript open/)).toBeVisible();
	await page.screenshot(shot('23-notes-no-manuscript'));

	await page.getByRole('button', { name: 'Files' }).click();
	await openManuscript(page);
	const last = page.locator('.ProseMirror p', { hasText: 'Pre-trained bidirectional encoders' });
	await last.click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.type(
		'Prune the roses in late winter, cutting each stem back to an outward-facing bud so the centre stays open.'
	);
	await page.getByRole('button', { name: 'Notes' }).click();
	await expect(
		page.getByText('Nothing in your notes or papers is close to this paragraph.')
	).toBeVisible();
	await page.screenshot(shot('24-notes-nothing-close'));
});

// M4-5: the Check panel, run on the planted chapter, one finding chosen.
test('shots of the Check panel', async ({ page }) => {
	await launch(page);
	await openProject(page);
	await openManuscript(page);
	await page.getByRole('button', { name: 'Planted', exact: true }).click();
	await page.getByRole('button', { name: 'Check' }).click();
	await page.screenshot(shot('25-check-not-run'));

	await page.getByRole('button', { name: 'Run check' }).click();
	await expect(page.getByText(/sentences checked against/)).toBeVisible();
	await page.screenshot({ ...shot('26-check-findings'), animations: 'disabled' });

	await page
		.getByRole('region', { name: 'Matches a source, no citation nearby' })
		.getByRole('button', { name: /Attention-only models/ })
		.first()
		.click();
	await expect(page.locator('.erti-check-sentence')).toHaveCount(1);
	await page.screenshot({ ...shot('27-check-beside-source'), animations: 'disabled' });

	// The writer's own edit.
	await replaceWord(page, 'entirely the writer', 'nothing', 'little');
	await expect(page.getByText('The document has changed since this check.')).toBeVisible();
	await page.screenshot({ ...shot('28-check-stale'), animations: 'disabled' });
});

// M5-1: a document's history, with yesterday's version chosen.
test('shots of History', async ({ page }) => {
	await launch(page);
	await openProject(page);
	await openManuscript(page);
	await page.getByRole('button', { name: 'Document menu for Chapter 1' }).click();
	await page.screenshot({ ...shot('29-document-menu'), animations: 'disabled' });
	await page.getByRole('menuitem', { name: 'History…' }).click();

	await page
		.getByRole('region', { name: 'Yesterday' })
		.getByRole('button', { name: /on close/ })
		.click();
	await expect(page.getByLabel('The snapshot, read-only')).toContainText('back-translation');
	await page.screenshot({ ...shot('30-history'), animations: 'disabled' });
});
