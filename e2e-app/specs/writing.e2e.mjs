import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser } from '@wdio/globals';

import { expect, ingested, openProject, type } from './app.mjs';

/**
 * Journey 1 (M1a-2 AC-2): from papers on disk to a LaTeX bundle on disk.
 *
 * Ingest reads the three PDFs and resolves each from the DOI it prints (the
 * one step that needs the network, so lookups are allowed for this journey
 * only); a citation is found by title and inserted; the bibliography follows;
 * the export writes files a journal would accept.
 */

describe('writing with sources', () => {
	it('ingests the project and resolves each paper', async () => {
		await openProject();
		expect(await ingested()).toBe(3);
	});

	it('cites a paper found by its title, and lists it in the bibliography', async () => {
		await $('div*=Chapter 1.erti.json').click();
		const editor = $('.ProseMirror');
		await editor.waitForDisplayed();
		await editor.click();

		await type('Attention-only models train in parallel ');
		await type('@Attention');
		const suggestions = $('[aria-label="Citation suggestions"]');
		await suggestions.waitForDisplayed();
		// The list is multi-select: pick, then insert.
		await suggestions.$('[role="option"]*=Attention').click();
		await $('button[aria-label="Insert selected citations"]').click();

		await expect(editor).toHaveText(expect.stringContaining('Vaswani'));
		// The works-cited list is part of the document.
		await expect(editor).toHaveText(expect.stringContaining('Attention Is All You Need'));
	});

	it('exports a LaTeX bundle to the project folder', async () => {
		await $('button*=.tex').click();

		const dir = join(process.env.ERTI_E2E_PROJECT, 'export');
		await browser.waitUntil(() => existsSync(join(dir, 'references.bib')), {
			timeout: 30_000,
			timeoutMsg: 'no export/references.bib was written'
		});

		const tex = readFileSync(join(dir, 'main.tex'), 'utf8');
		const bib = readFileSync(join(dir, 'references.bib'), 'utf8');
		expect(tex).toMatch(/\\cite[pt]?\{/);
		expect(bib).toContain('Attention Is All You Need');
	});

	// M1a-12 AC-1, AC-3 and AC-4, in the real app.
	it('keeps one log on this machine, with nothing that was written in it', async () => {
		// An error nothing catches, thrown in the webview as a bug would be.
		await browser.execute(() => {
			setTimeout(() => {
				throw new Error('Probe from the journey');
			});
		});
		await $('div*=Something went wrong: Probe from the journey').waitForDisplayed();

		const dir = join(process.env.ERTI_E2E_HOME, '.local', 'share', 'com.erti.app', 'logs');
		const read = () => {
			const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.log')) : [];
			return files.length === 1 ? readFileSync(join(dir, files[0]), 'utf8') : '';
		};
		await browser.waitUntil(() => read().includes('Probe from the journey'), {
			timeout: 10_000,
			timeoutMsg: `no log in ${dir} with the webview's line`
		});

		expect(readdirSync(dir).filter((f) => f.endsWith('.log'))).toHaveLength(1);
		const logged = read();
		// Rust's lines and the webview's, in the one file.
		expect(logged).toMatch(/Erti \S+ started on linux/);
		expect(logged).toMatch(/Uncaught error: Error: Probe from the journey/);
		// What was typed into the manuscript isn't.
		expect(logged).not.toContain('Attention-only models train in parallel');
	});
});
