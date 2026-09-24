import { afterEach, describe, expect, it, vi } from 'vitest';

import { Editor } from '$lib/editor/core/Editor';
import { editorExtensions } from '$lib/editor/core/extensions';
import { nudgeKey, showNudge } from './NoteNudge';

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
