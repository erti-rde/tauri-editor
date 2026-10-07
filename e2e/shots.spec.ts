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
