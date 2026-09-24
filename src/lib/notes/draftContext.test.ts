import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

import { Editor } from '$lib/editor/core/Editor';
import { editorExtensions } from '$lib/editor/core/extensions';
import {
	citedSources,
	draftContext,
	MINIMUM_CONTEXT,
	NUDGE_THRESHOLD,
	paragraphAt,
	worthNudging
} from './draftContext';

/**
 * Built against a real editor rather than a hand-made document, for the same
 * reason the outline tests are: the thing being read is a ProseMirror node, and
 * a stub of one would only prove the stub matches the code.
 */

let editor: Editor | undefined;

function docOf(html: string) {
	editor = new Editor({
		element: document.createElement('div'),
		extensions: editorExtensions,
		content: html
	});
	return editor.state.doc;
}

afterEach(() => {
	editor?.destroy();
	editor = undefined;
});

const LONG = 'The effect was strongest in the treated group, which matters here.';

describe('reading what is being written', () => {
	it('finds the paragraph holding the cursor', () => {
		const doc = docOf(`<p>${LONG}</p>`);

		expect(paragraphAt(doc, 3)).toBe(LONG);
	});

	it('picks the paragraph the cursor is actually in', () => {
		const second = `Another paragraph entirely, also long enough to be worth searching on.`;
		const doc = docOf(`<p>${LONG}</p><p>${second}</p>`);

		expect(paragraphAt(doc, doc.content.size - 3)).toBe(second);
	});

	it('says nothing for a fragment', () => {
		// A heading or half a sentence produces matches that change on every
		// keystroke, which is a panel that flickers rather than one that helps.
		expect(paragraphAt(docOf('<p>Short</p>'), 3)).toBe('');
	});

	it('has a threshold that is about a sentence, not a word', () => {
		expect(MINIMUM_CONTEXT).toBeGreaterThan(20);
	});

	it('says nothing for a position outside the document', () => {
		const doc = docOf(`<p>${LONG}</p>`);

		expect(paragraphAt(doc, -1)).toBe('');
		expect(paragraphAt(doc, 10_000)).toBe('');
	});
});

describe('the channel to the panel', () => {
	it('carries the paragraph', () => {
		draftContext.report({ paragraph: LONG });

		expect(get(draftContext).paragraph).toBe(LONG);
	});

	it('carries a way to cite, because only the editor has one', () => {
		const cite = async () => {};
		draftContext.report({ cite });

		expect(get(draftContext).cite).toBe(cite);
	});

	it('lets go of both when the editor goes away', () => {
		// The panel outlives the editor when a project is closed. A stale
		// paragraph would show matches for writing nobody can see, and a stale
		// cite would insert into a destroyed view.
		draftContext.report({ paragraph: LONG, cite: async () => {} });
		draftContext.clear();

		expect(get(draftContext)).toEqual({ paragraph: '', cite: null });
	});
});

describe('deciding whether a note is worth mentioning', () => {
	const sources = [
		{ sha256: 'strong', similarity: 0.8 },
		{ sha256: 'weak', similarity: 0.2 },
		{ sha256: 'cited', similarity: 0.9 }
	];

	it('mentions a close note the paragraph has not used', () => {
		expect(worthNudging(sources, new Set(['cited'])).map((s) => s.sha256)).toEqual(['strong']);
	});

	it('says nothing about a paper already cited here', () => {
		// The writer has plainly seen it. Pointing at it again is the nagging that
		// gets a feature switched off.
		expect(worthNudging(sources, new Set(['strong', 'cited']))).toEqual([]);
	});

	it('says nothing about a distant match', () => {
		expect(worthNudging([{ sha256: 'weak', similarity: 0.2 }], new Set())).toEqual([]);
	});

	it('errs towards silence', () => {
		// A margin that fills with marks is worse than one that stays empty, so
		// the bar sits above the midpoint rather than at it.
		expect(NUDGE_THRESHOLD).toBeGreaterThan(0.5);
	});

	it('has nothing to say when nothing was found', () => {
		expect(worthNudging([], new Set())).toEqual([]);
	});
});

describe('what a paragraph already cites', () => {
	function paragraphOf(html: string) {
		return docOf(html).child(0);
	}

	it('finds nothing in a paragraph with no citations', () => {
		expect(citedSources(paragraphOf(`<p>${LONG}</p>`)).size).toBe(0);
	});

	it('finds the paper a citation stands for', () => {
		const html = `<p>Some prose <span data-type="citation" data-id="${JSON.stringify(['sha-1']).replace(/"/g, '&quot;')}" data-label="(Smith 2020)"></span></p>`;

		expect([...citedSources(paragraphOf(html))]).toEqual(['sha-1']);
	});

	it('finds every paper in a citation that stands for several', () => {
		// One marker can cite two works, and missing the second would nudge about
		// a paper the writer has plainly already used.
		const ids = JSON.stringify(['sha-1', 'sha-2']).replace(/"/g, '&quot;');
		const html = `<p>Prose <span data-type="citation" data-id="${ids}" data-label="(Smith 2020; Jones 2019)"></span></p>`;

		expect([...citedSources(paragraphOf(html))].sort()).toEqual(['sha-1', 'sha-2']);
	});
});
