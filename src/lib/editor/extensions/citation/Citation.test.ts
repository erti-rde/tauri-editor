import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

import { CitationEngine } from '$lib/citations/engine';
import { citationStore, type CitationItem } from '$lib/stores/citationStore';
import { Citation } from './Citation';

/**
 * The wiring, end to end: a real editor, real citeproc, real CSL styles.
 *
 * The unit tests under lib/citations prove the engine renders a document
 * correctly. These prove the editor actually asks it to — which is the part
 * that was broken, and which no amount of engine testing would have caught.
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

/**
 * TipTap defers its `create` event by a tick, so the extension's render-on-open
 * has not run when the constructor returns. Waiting here is what a real editor
 * does too — nothing is on screen before the next frame either.
 */
async function editorWith(...citedIds: string[][]) {
	const editor = new Editor({
		extensions: [StarterKit, Citation],
		content: {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: citedIds.map((ids) => ({
						type: 'citation',
						attrs: { id: JSON.stringify(ids), label: 'pending' }
					}))
				}
			]
		}
	});

	await new Promise((resolve) => setTimeout(resolve, 0));

	return editor;
}

/** The rendered label of every citation, in document order. */
function labels(editor: Editor): string[] {
	const found: string[] = [];
	editor.state.doc.descendants((node) => {
		if (node.type.name === 'citation') found.push(String(node.attrs.label));
		return true;
	});
	return found;
}

/** The note number recorded against each citation, in document order. */
function noteIndices(editor: Editor): number[] {
	const found: number[] = [];
	editor.state.doc.descendants((node) => {
		if (node.type.name === 'citation') found.push(Number(node.attrs.noteIndex) || 0);
		return true;
	});
	return found;
}

const plain = (html: string) =>
	html
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();

beforeEach(() => useStyle('apa'));

describe('citations react to the document', () => {
	it('disambiguates when a second same-author same-year source is cited', async () => {
		// The whole defect in one assertion. Formatted in isolation, both of these
		// render "(Smith, 2020)" and the reader cannot tell the papers apart.
		const editor = await editorWith(['smith-2020-a'], ['smith-2020-b']);

		expect(plain(labels(editor)[0])).toContain('2020a');
		expect(plain(labels(editor)[1])).toContain('2020b');

		editor.destroy();
	});

	it('drops the disambiguation again when the other source stops being cited', async () => {
		const editor = await editorWith(['smith-2020-a'], ['smith-2020-b']);
		expect(plain(labels(editor)[0])).toContain('2020a');

		// Remove the second citation. The first is no longer ambiguous, so its
		// letter has to go — an edit elsewhere changing a citation you did not
		// touch is exactly what per-citation rendering cannot do.
		editor.commands.setTextSelection({ from: 2, to: 3 });
		editor.commands.deleteSelection();

		expect(plain(labels(editor)[0])).not.toContain('2020a');

		editor.destroy();
	});

	it('numbers notes in document order and renumbers on insertion', async () => {
		useStyle('chicago-notes-bibliography');
		const editor = await editorWith(['smith-2020-a'], ['okafor-2019']);

		expect(labels(editor)).toEqual(['1', '2']);

		// A note inserted at the front pushes every later note number up by one.
		editor.commands.insertContentAt(1, {
			type: 'citation',
			attrs: { id: JSON.stringify(['tanaka-2021-book']), label: 'pending' }
		});

		expect(labels(editor)).toEqual(['1', '2', '3']);
		expect(noteIndices(editor)).toEqual([1, 2, 3]);

		editor.destroy();
	});

	it('leaves a marker in the sentence, not the whole reference', async () => {
		// Chicago and Turabian exist to keep the reference out of the prose. The
		// editor used to render citeproc's note text inline, so a sentence read
		// "…as argued Alice Smith, \u201cCoastal Erosion under Rising Sea Levels,\u201d
		// Journal of Coastal Research 36, no. 2 (2020): 101-18. in the literature".
		useStyle('chicago-notes-bibliography');
		const editor = await editorWith(['smith-2020-a']);

		expect(labels(editor)[0]).toBe('1');
		expect(plain(editor.getText())).not.toContain('Coastal Research');

		editor.destroy();
	});

	it('puts the citation in the sentence for an in-text style', async () => {
		// The same document under APA: no marker, the citation reads in place.
		const editor = await editorWith(['smith-2020-a']);

		expect(plain(labels(editor)[0])).toContain('Smith');
		expect(noteIndices(editor)).toEqual([0]);

		editor.destroy();
	});

	it('marks a citation whose source has been removed', async () => {
		const editor = await editorWith(['smith-2020-a'], ['no-such-source']);

		expect(plain(labels(editor)[0])).toContain('Smith');
		expect(labels(editor)[1]).toContain('removed');

		editor.destroy();
	});

	it('renders the citations a manuscript was opened with', async () => {
		// Loading a document is not a transaction, so nothing else re-renders it.
		// Without this the labels stay as they were last saved, and go stale as
		// soon as the library or the chosen style moves on.
		const editor = await editorWith(['okafor-2019']);

		expect(labels(editor)[0]).not.toBe('pending');
		expect(plain(labels(editor)[0])).toContain('Okafor');

		editor.destroy();
	});

	it('leaves a document without citations alone', () => {
		const editor = new Editor({
			extensions: [StarterKit, Citation],
			content: '<p>Nothing cited here.</p>'
		});

		expect(editor.getText()).toBe('Nothing cited here.');

		editor.destroy();
	});

	it('re-renders every citation when the style changes', async () => {
		const editor = await editorWith(['smith-2020-a'], ['okafor-2019']);
		const inApa = labels(editor);

		useStyle('ieee');
		editor.commands.updateAllCitation();

		// IEEE is numeric; APA is author-date. Same document, different output.
		expect(labels(editor)).not.toEqual(inApa);
		expect(plain(labels(editor)[0])).toContain('1');

		editor.destroy();
	});
});
