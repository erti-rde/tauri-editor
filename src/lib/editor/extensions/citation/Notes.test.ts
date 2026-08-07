import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

import { CitationEngine } from '$lib/citations/engine';
import { citationStore, type CitationItem } from '$lib/stores/citationStore';
import { Bibliography, BIBLIOGRAPHY_NODE } from './Bibliography';
import { Citation } from './Citation';
import { Notes, NOTES_NODE, type NoteEntry } from './Notes';

/**
 * Note styles, end to end.
 *
 * Chicago notes-bibliography and Turabian are the humanities standard and have
 * never worked in this editor: citeproc returns the *note text* for these
 * styles, and the editor rendered it inline, dropping a full reference into the
 * middle of the author's sentence.
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
		extensions: [StarterKit, Citation, Notes, Bibliography],
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
				{ type: NOTES_NODE, attrs: { notes: [] } }
			]
		}
	});
	await new Promise((r) => setTimeout(r, 0));
	return editor;
}

function notesOf(editor: Editor): NoteEntry[] {
	let found: NoteEntry[] = [];
	editor.state.doc.descendants((node) => {
		if (node.type.name === NOTES_NODE) found = node.attrs.notes ?? [];
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

beforeEach(() => useStyle('chicago-notes-bibliography'));

describe('notes in a note style', () => {
	it('collects each citation as a numbered note', async () => {
		const editor = await editorWith(['smith-2020-a'], ['okafor-2019']);

		const notes = notesOf(editor);

		expect(notes.map((n) => n.index)).toEqual([1, 2]);
		expect(plain(notes[0].text)).toContain('Smith');
		expect(plain(notes[1].text)).toContain('Okafor');
	});

	it('gives the work in full first and shortens the repeat', async () => {
		// The behaviour a note style is chosen for. Rendering each citation in
		// isolation could never produce it: the short form only exists relative
		// to an earlier note.
		const editor = await editorWith(['smith-2020-a'], ['okafor-2019'], ['smith-2020-a']);

		const notes = notesOf(editor);

		expect(plain(notes[2].text).length).toBeLessThan(plain(notes[0].text).length);
		expect(plain(notes[2].text)).toContain('Smith');
	});

	it('renumbers when a citation is inserted before others', async () => {
		const editor = await editorWith(['smith-2020-a'], ['okafor-2019']);

		editor.commands.insertContentAt(1, {
			type: 'citation',
			attrs: { id: JSON.stringify(['tanaka-2021-book']), label: 'pending' }
		});

		const notes = notesOf(editor);

		expect(notes.map((n) => n.index)).toEqual([1, 2, 3]);
		expect(plain(notes[0].text)).toContain('Tanaka');
	});

	it('empties when the citations are gone', async () => {
		const editor = await editorWith(['smith-2020-a']);
		expect(notesOf(editor)).toHaveLength(1);

		editor.commands.setContent({
			type: 'doc',
			content: [{ type: 'paragraph' }, { type: NOTES_NODE, attrs: { notes: notesOf(editor) } }]
		});
		await new Promise((r) => setTimeout(r, 0));

		expect(notesOf(editor)).toEqual([]);
	});

	it('holds nothing for an in-text style', async () => {
		// APA puts the citation in the sentence, so there is no note to collect.
		useStyle('apa');
		const editor = await editorWith(['smith-2020-a']);

		expect(notesOf(editor)).toEqual([]);
	});

	it('empties when the user switches from a note style to an in-text one', async () => {
		const editor = await editorWith(['smith-2020-a']);
		expect(notesOf(editor)).toHaveLength(1);

		useStyle('apa');
		editor.commands.updateAllCitation();

		expect(notesOf(editor)).toEqual([]);
	});
});

describe('notes as part of the manuscript', () => {
	it('survives a save and reaches exported HTML', async () => {
		const editor = await editorWith(['okafor-2019']);

		expect(JSON.stringify(editor.getJSON())).toContain('Okafor');
		expect(plain(editor.getHTML())).toContain('Okafor');
		expect(editor.getHTML()).toContain('Notes');
	});

	it('numbers the exported list from the note numbers, not the list order', async () => {
		// An ordered list would otherwise restart at 1 and disagree with the
		// markers in the text.
		const editor = await editorWith(['smith-2020-a'], ['okafor-2019']);

		expect(editor.getHTML()).toContain('value="1"');
		expect(editor.getHTML()).toContain('value="2"');
	});

	it('explains itself when a style produces no notes', async () => {
		useStyle('apa');
		const editor = await editorWith(['smith-2020-a']);

		expect(editor.getHTML()).toContain('when the citation style uses them');
	});

	it('adds a notes section to a manuscript that predates them', async () => {
		// A document written before notes existed has a references list and
		// nowhere for its notes to go. Returning early on the strength of the
		// bibliography alone left such a document permanently unable to gain one.
		const editor = new Editor({
			extensions: [StarterKit, Citation, Notes, Bibliography],
			content: {
				type: 'doc',
				content: [
					{ type: 'paragraph' },
					{ type: BIBLIOGRAPHY_NODE, attrs: { entries: [], missing: 0 } }
				]
			}
		});
		await new Promise((r) => setTimeout(r, 0));

		editor.commands.insertBibliography();

		let notes = 0;
		editor.state.doc.descendants((node) => {
			if (node.type.name === NOTES_NODE) notes++;
			return true;
		});
		expect(notes).toBe(1);
	});

	it('is added alongside the references section', async () => {
		const editor = new Editor({
			extensions: [StarterKit, Citation, Notes, Bibliography],
			content: { type: 'doc', content: [{ type: 'paragraph' }] }
		});
		await new Promise((r) => setTimeout(r, 0));

		editor.commands.insertBibliography();

		const kinds: string[] = [];
		editor.state.doc.descendants((node) => {
			if (node.type.name === NOTES_NODE || node.type.name === BIBLIOGRAPHY_NODE) {
				kinds.push(node.type.name);
			}
			return true;
		});
		// Notes first: the references list is conventionally last.
		expect(kinds).toEqual([NOTES_NODE, BIBLIOGRAPHY_NODE]);
	});

	it('still works when Notes is not registered at all', async () => {
		// Bibliography must stay usable on its own; referring to an unregistered
		// node type fails the whole insert with nothing to show for it.
		const editor = new Editor({
			extensions: [StarterKit, Citation, Bibliography],
			content: { type: 'doc', content: [{ type: 'paragraph' }] }
		});
		await new Promise((r) => setTimeout(r, 0));

		editor.commands.insertBibliography();

		let count = 0;
		editor.state.doc.descendants((node) => {
			if (node.type.name === BIBLIOGRAPHY_NODE) count++;
			return true;
		});
		expect(count).toBe(1);
	});
});
