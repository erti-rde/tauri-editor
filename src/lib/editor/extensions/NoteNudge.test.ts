import { afterEach, describe, expect, it, vi } from 'vitest';

import { Editor } from '$lib/editor/core/Editor';
import { editorExtensions } from '$lib/editor/core/extensions';
import { nudgeKey, showNudge } from './NoteNudge';
import { matchesFrom, nudgeFor } from '$lib/notes/draftContext';
import type { NoteHit } from '$lib/stores/db';

/**
 * The mark in the margin is a decoration, and the point of it being one is that
 * it is not content. These check the ways that could quietly stop being true:
 * ending up in the saved file, in an export, or in the undo history.
 */

let editor: Editor | undefined;

function makeEditor(content = '<p>The effect was strongest in the treated group.</p>') {
	editor = new Editor({
		element: document.createElement('div'),
		extensions: editorExtensions,
		content
	});
	return editor;
}

function marks(instance: Editor): number {
	return instance.view.dom.querySelectorAll('.erti-nudge').length;
}

afterEach(() => {
	editor?.destroy();
	editor = undefined;
});

describe('the mark in the margin', () => {
	it('is not there until there is something to say', () => {
		const instance = makeEditor();

		expect(nudgeKey.getState(instance.state)).toEqual({ pos: null, count: 0 });
		expect(marks(instance)).toBe(0);
	});

	it('appears beside the paragraph it is about', () => {
		const instance = makeEditor();

		showNudge(instance.view, { pos: 0, count: 2 });

		expect(marks(instance)).toBe(1);
	});

	it('says how many notes it stands for, for a screen reader', () => {
		const instance = makeEditor();

		showNudge(instance.view, { pos: 0, count: 3 });

		expect(instance.view.dom.querySelector('.erti-nudge')?.getAttribute('aria-label')).toBe(
			'You have 3 notes that bear on this paragraph'
		);
	});

	it('reads naturally for a single note', () => {
		const instance = makeEditor();

		showNudge(instance.view, { pos: 0, count: 1 });

		expect(instance.view.dom.querySelector('.erti-nudge')?.getAttribute('aria-label')).toBe(
			'You have a note that bears on this paragraph'
		);
	});

	it('goes away again', () => {
		const instance = makeEditor();

		showNudge(instance.view, { pos: 0, count: 1 });
		showNudge(instance.view, { pos: null, count: 0 });

		expect(marks(instance)).toBe(0);
	});

	it('never becomes part of the document', () => {
		// It must not reach the saved file, a co-author, or an export. A node
		// would; a decoration cannot.
		const instance = makeEditor();
		const before = JSON.stringify(instance.getJSON());

		showNudge(instance.view, { pos: 0, count: 1 });

		expect(JSON.stringify(instance.getJSON())).toBe(before);
		expect(instance.getHTML()).not.toContain('erti-nudge');
	});

	it('stays out of the undo history', () => {
		// Undoing a keystroke should not first undo a dot appearing.
		const instance = makeEditor();
		instance.commands.insertContent(' More words.');
		const withEdit = instance.getHTML();

		showNudge(instance.view, { pos: 0, count: 1 });
		instance.commands.undo();

		expect(instance.getHTML()).not.toBe(withEdit);
	});

	it('does not dispatch when nothing has changed', () => {
		// The effect that drives this runs on every published match, and a
		// transaction per run would be a transaction per keystroke-pause.
		const instance = makeEditor();
		showNudge(instance.view, { pos: 0, count: 1 });

		const dispatch = vi.spyOn(instance.view, 'dispatch');
		showNudge(instance.view, { pos: 0, count: 1 });

		expect(dispatch).not.toHaveBeenCalled();
		dispatch.mockRestore();
	});

	it('keeps up with text typed above it', () => {
		// Mapped through edits, so it stays with its paragraph rather than
		// sliding up the page as the document grows.
		const instance = makeEditor('<p>First.</p><p>Second paragraph here.</p>');
		const second = instance.state.doc.child(0).nodeSize;

		showNudge(instance.view, { pos: second, count: 1 });
		instance.commands.setTextSelection(1);
		instance.commands.insertContent('Words added before. ');

		const after = nudgeKey.getState(instance.state);
		expect(after?.pos).toBeGreaterThan(second);
		expect(marks(instance)).toBe(1);
	});

	it('gives up if the paragraph it marked is deleted', () => {
		const instance = makeEditor('<p>First.</p><p>Second.</p>');
		const second = instance.state.doc.child(0).nodeSize;

		showNudge(instance.view, { pos: second, count: 1 });
		instance.commands.setContent('<p>Something else entirely.</p>');

		expect(marks(instance)).toBe(0);
	});
});

// M3-3: what the Notes panel found, as the margin reads it.
describe('a note on a source, in the margin', () => {
	const WRITTEN = 'Oral cultures add one thing to another rather than subordinating them.';
	const canonical = (id: string) => ({ 'sha-ong-pdf': 'erti:ong' })[id] ?? id;

	/** A source note as the panel's search returns it (M1b-8). */
	const sourceNote = (source_id: string, similarity = 0.7) =>
		({ kind: 'source_note', hit: { source_id, similarity } }) as unknown as NoteHit;
	const mark = (source_id: string, similarity = 0.7) =>
		({ kind: 'annotation', hit: { source_id, similarity } }) as unknown as NoteHit;

	const citing = (id: string) =>
		`<span data-type="citation" data-id="${JSON.stringify([id]).replace(/"/g, '&quot;')}" data-label="(Ong 1982)"></span>`;

	function nudge(instance: Editor, notes: NoteHit[]) {
		const { doc } = instance.state;
		showNudge(instance.view, nudgeFor(doc, 1, matchesFrom(WRITTEN, notes), canonical));
	}

	// M3-3 AC-1, AC-2
	it('counts a source note toward the mark', () => {
		const instance = makeEditor(`<p>${WRITTEN}</p>`);

		nudge(instance, [sourceNote('erti:ong')]);

		expect(marks(instance)).toBe(1);
		expect(instance.view.dom.querySelector('.erti-nudge')?.getAttribute('aria-label')).toBe(
			'You have a note that bears on this paragraph'
		);
	});

	// M3-3 AC-1: still one ring for the paragraph, however many notes.
	it('counts it with the marks, in one mark for the paragraph', () => {
		const instance = makeEditor(`<p>${WRITTEN}</p><p>Another paragraph.</p>`);

		nudge(instance, [mark('sha-1'), sourceNote('erti:ong'), mark('sha-2')]);

		expect(marks(instance)).toBe(1);
		expect(nudgeKey.getState(instance.state)).toEqual({ pos: 0, count: 3 });
	});

	// M3-3 AC-1: a book already cited here isn't news, whichever id cites it.
	it('leaves out a source note on a work the paragraph already cites', () => {
		const instance = makeEditor(`<p>${WRITTEN} ${citing('sha-ong-pdf')}</p>`);
		const { doc } = instance.state;
		const written = doc.child(0).textContent.trim();

		showNudge(
			instance.view,
			nudgeFor(doc, 1, matchesFrom(written, [sourceNote('erti:ong')]), canonical)
		);

		expect(marks(instance)).toBe(0);
	});

	it('leaves out a source note too faint to mention', () => {
		const instance = makeEditor(`<p>${WRITTEN}</p>`);

		nudge(instance, [sourceNote('erti:ong', 0.2)]);

		expect(marks(instance)).toBe(0);
	});
});
