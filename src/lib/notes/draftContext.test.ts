import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

import { Editor } from '$lib/editor/core/Editor';
import { editorExtensions } from '$lib/editor/core/extensions';
import {
	citedSources,
	createFollower,
	draftContext,
	firstWords,
	FOLLOW_IDLE_MS,
	MINIMUM_CONTEXT,
	NUDGE_THRESHOLD,
	paragraphAt,
	SHOWN_FLOOR,
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

		expect(get(draftContext)).toEqual({ paragraph: '', cited: [], cite: null });
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

	// M3-5: what is listed when the writer looks is wider than what is
	// mentioned unasked, so a note in the margin is always one in the panel.
	it('mentions only what the panel would list', () => {
		expect(SHOWN_FLOOR.note).toBeLessThan(NUDGE_THRESHOLD);
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

// M3-1 AC-3: when the panel hears about the writing.
describe('following the writing', () => {
	const SECOND = 'Another paragraph entirely, also long enough to be worth searching on.';

	afterEach(() => {
		vi.useRealTimers();
	});

	/** An editor and a follower watching it, as the editor's own hooks call it. */
	function watched(html: string) {
		vi.useFakeTimers();
		docOf(html);
		const publish = vi.fn();
		const follower = createFollower(publish);
		const update = () => follower.update(editor!.state.doc, editor!.state.selection.from);
		return { publish, follower, update, editor: editor! };
	}

	it('never asks per keystroke: typing in a paragraph asks once, after 600 ms idle', () => {
		const { publish, update, editor } = watched(`<p>${LONG}</p>`);
		editor.commands.setTextSelection(10);
		update();
		// Arriving in a paragraph says so at once.
		expect(publish).toHaveBeenCalledTimes(1);

		for (const letter of 'and so on') {
			editor.commands.insertContent(letter);
			update();
			vi.advanceTimersByTime(100);
		}
		expect(publish).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(FOLLOW_IDLE_MS - 100 - 1);
		expect(publish).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(1);
		expect(publish).toHaveBeenCalledTimes(2);
		expect(publish).toHaveBeenLastCalledWith({
			paragraph: editor.state.doc.child(0).textContent,
			cited: []
		});
		expect(FOLLOW_IDLE_MS).toBe(600);
	});

	it('asks at once when the cursor leaves a paragraph', () => {
		const { publish, update, editor } = watched(`<p>${LONG}</p><p>${SECOND}</p>`);
		editor.commands.setTextSelection(3);
		update();

		editor.commands.setTextSelection(editor.state.doc.content.size - 3);
		update();

		expect(publish).toHaveBeenCalledTimes(2);
		expect(publish).toHaveBeenLastCalledWith({ paragraph: SECOND, cited: [] });
		// And not again when the pause after the move runs out.
		vi.advanceTimersByTime(FOLLOW_IDLE_MS * 2);
		expect(publish).toHaveBeenCalledTimes(2);
	});

	it('asks about the paragraph just finished when Enter leaves it for an empty one', () => {
		// Typed without a pause, it was never asked about; the new line has
		// nothing to go on yet.
		const { publish, update, editor } = watched(`<p>Short</p>`);
		editor.commands.setTextSelection(6);
		update();
		expect(publish).not.toHaveBeenCalled();

		for (const word of LONG.split(' ')) {
			editor.commands.insertContent(` ${word}`);
			update();
		}
		editor.commands.splitBlock();
		update();

		expect(publish).toHaveBeenCalledTimes(1);
		expect(publish.mock.calls[0][0].paragraph).toBe(`Short ${LONG}`);
	});

	it('says nothing while the cursor is in a fragment', () => {
		const { publish, update, editor } = watched(`<p>Short</p>`);
		editor.commands.setTextSelection(3);
		update();
		vi.advanceTimersByTime(FOLLOW_IDLE_MS);

		expect(publish).not.toHaveBeenCalled();
	});

	it('says what the paragraph already cites, by canonical id', () => {
		const ids = JSON.stringify(['file-hash', 'erti:book']).replace(/"/g, '&quot;');
		const { publish, follower, editor } = watched(
			`<p>${LONG} <span data-type="citation" data-id="${ids}" data-label="(Ong 1982)"></span></p>`
		);
		const canonical = (id: string) => (id === 'file-hash' ? 'erti:book' : id);

		follower.update(editor.state.doc, 3, canonical);

		expect(publish).toHaveBeenCalledWith({ paragraph: expect.any(String), cited: ['erti:book'] });
	});

	it('stops when the editor goes', () => {
		const { publish, follower, update, editor } = watched(`<p>${LONG}</p>`);
		update();
		editor.commands.insertContent('x');
		update();
		follower.stop();
		vi.advanceTimersByTime(FOLLOW_IDLE_MS);

		expect(publish).toHaveBeenCalledTimes(1);
	});
});

// M3-1 AC-1: "Related to: Sequence models built on…"
describe('naming the paragraph followed', () => {
	it('gives its first words, and says there are more', () => {
		expect(firstWords('Sequence models built on recurrence dominated for years.')).toBe(
			'Sequence models built on recurrence…'
		);
	});

	it('gives a short paragraph whole', () => {
		expect(firstWords('  Attention is all  ')).toBe('Attention is all');
	});
});
