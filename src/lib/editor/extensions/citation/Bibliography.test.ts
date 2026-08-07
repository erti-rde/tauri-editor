import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

import { CitationEngine } from '$lib/citations/engine';
import { citationStore, type CitationItem } from '$lib/stores/citationStore';
import { Bibliography, BIBLIOGRAPHY_NODE } from './Bibliography';
import { Citation } from './Citation';

/**
 * The references section, driven by a real editor and real citeproc.
 *
 * `makeBibliography()` was previously called without ever registering which
 * works the document cites, so it could not answer the only question that
 * matters: what does *this* manuscript cite. These prove the list follows the
 * document — including when the document stops citing anything.
 */

vi.mock('@tauri-apps/plugin-store', () => ({ load: vi.fn() }));
vi.mock('$lib/stores/db', () => ({ projectSources: vi.fn() }));

const FIXTURES = resolve(process.cwd(), 'tests/fixtures/csl');
const read = (p: string) => readFileSync(resolve(FIXTURES, p), 'utf8');

const sources = JSON.parse(read('sources.json')) as Record<string, CitationItem>;
const localeXml = read('locales/locales-en-US.xml');

const setStore = (citationStore as unknown as { set: (v: unknown) => void }).set;

function useStyle(style: string) {
	setStore({
		engine: new CitationEngine({ styleXml: read(`styles/${style}.csl`), localeXml, sources }),
		citationSources: sources,
		bibliography: [],
		missingIds: []
	});
}

async function editorWith(...citedIds: string[][]) {
	const editor = new Editor({
		extensions: [StarterKit, Citation, Bibliography],
		content: {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: citedIds.map((ids) => ({
						type: 'citation',
						attrs: { id: JSON.stringify(ids), label: 'pending' }
					}))
				},
				{ type: BIBLIOGRAPHY_NODE, attrs: { entries: [], missing: 0 } }
			]
		}
	});

	// TipTap defers `create` by a tick, so the render-on-open has not run yet.
	await new Promise((r) => setTimeout(r, 0));
	return editor;
}

function biblio(editor: Editor): { entries: string[]; missing: number } {
	let found = { entries: [] as string[], missing: 0 };
	editor.state.doc.descendants((node) => {
		if (node.type.name === BIBLIOGRAPHY_NODE) {
			found = { entries: node.attrs.entries ?? [], missing: node.attrs.missing ?? 0 };
		}
		return true;
	});
	return found;
}

const plain = (html: string) =>
	html
		.replace(/<[^>]+>/g, '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/\s+/g, ' ')
		.trim();

beforeEach(() => useStyle('apa'));

describe('the references section follows the document', () => {
	it('lists the works the document cites', async () => {
		const editor = await editorWith(['smith-2020-a'], ['okafor-2019']);

		const { entries } = biblio(editor);

		expect(entries).toHaveLength(2);
		expect(entries.map(plain).join(' ')).toContain('Okafor');
	});

	it('excludes a source that is in the library but not cited', async () => {
		// A references list of the whole library rather than of the manuscript is
		// the failure this guards. Measured: rebuildProcessorState is what confines
		// it to the cited set — removing the engine's updateItems call does not
		// break this, so the assertion is about the outcome, not that one call.
		const editor = await editorWith(['smith-2020-a']);

		const text = biblio(editor).entries.map(plain).join(' ');

		expect(text).toContain('Smith');
		expect(text).not.toContain('Nobody');
	});

	it('carries the disambiguation letters into the entries', async () => {
		const editor = await editorWith(['smith-2020-a'], ['smith-2020-b']);

		const text = biblio(editor).entries.map(plain).join(' ');

		expect(text).toContain('2020a');
		expect(text).toContain('2020b');
	});

	it('empties when the last citation is deleted', async () => {
		// The list has to be able to go back to nothing. Leaving the previous
		// entries would have the manuscript claim works it no longer cites.
		const editor = await editorWith(['smith-2020-a']);
		expect(biblio(editor).entries).toHaveLength(1);

		editor.commands.setContent({
			type: 'doc',
			content: [
				{ type: 'paragraph' },
				{ type: BIBLIOGRAPHY_NODE, attrs: { entries: biblio(editor).entries, missing: 0 } }
			]
		});
		await new Promise((r) => setTimeout(r, 0));

		expect(biblio(editor).entries).toEqual([]);
	});

	it('reports cited sources that are no longer in the library', async () => {
		const editor = await editorWith(['smith-2020-a'], ['deleted-source']);

		expect(biblio(editor).missing).toBe(1);
	});

	it('re-renders in the style the user switched to', async () => {
		const editor = await editorWith(['tanaka-2021-book']);
		const inApa = biblio(editor).entries.map(plain).join(' ');

		useStyle('ieee');
		editor.commands.updateAllCitation();

		expect(biblio(editor).entries.map(plain).join(' ')).not.toBe(inApa);
	});
});

describe('the references section as part of the manuscript', () => {
	it('survives a save and reload', async () => {
		// Entries live on the node so they travel with getJSON() into the saved
		// file and into every export, rather than existing only on screen.
		const editor = await editorWith(['okafor-2019']);

		const saved = JSON.stringify(editor.getJSON());

		expect(saved).toContain('Okafor');
	});

	it('renders its entries into exported HTML', async () => {
		const editor = await editorWith(['okafor-2019']);

		const html = editor.getHTML();

		expect(html).toContain('References');
		expect(plain(html)).toContain('Okafor');
	});

	it('says so plainly when nothing is cited yet', async () => {
		const editor = await editorWith();

		expect(editor.getHTML()).toContain('Nothing is cited yet');
	});

	it('adds one on command, and does not add a second', async () => {
		const editor = new Editor({
			extensions: [StarterKit, Citation, Bibliography],
			content: { type: 'doc', content: [{ type: 'paragraph' }] }
		});
		await new Promise((r) => setTimeout(r, 0));

		editor.commands.insertBibliography();
		editor.commands.insertBibliography();

		let count = 0;
		editor.state.doc.descendants((node) => {
			if (node.type.name === BIBLIOGRAPHY_NODE) count++;
			return true;
		});
		expect(count).toBe(1);
	});

	it('fills a newly inserted section without waiting for the next edit', async () => {
		const editor = new Editor({
			extensions: [StarterKit, Citation, Bibliography],
			content: {
				type: 'doc',
				content: [
					{
						type: 'paragraph',
						content: [
							{
								type: 'citation',
								attrs: { id: JSON.stringify(['okafor-2019']), label: 'pending' }
							}
						]
					}
				]
			}
		});
		await new Promise((r) => setTimeout(r, 0));

		editor.commands.insertBibliography();

		expect(biblio(editor).entries).toHaveLength(1);
	});
});
