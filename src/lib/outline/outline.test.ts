import { afterEach, describe, expect, it } from 'vitest';

import { Editor } from '$lib/editor/core/Editor';
import { editorExtensions } from '$lib/editor/core/extensions';
import { headingAt, readOutline, sameOutline, type Heading } from './outline';

/**
 * Built against a real editor rather than a hand-made document, because the
 * thing being read is TipTap's heading node and a stub of it would only prove
 * the stub matches the code.
 */

let editor: Editor | undefined;

function outlineOf(html: string): Heading[] {
	editor = new Editor({
		element: document.createElement('div'),
		extensions: editorExtensions,
		content: html
	});

	return readOutline(editor.state.doc);
}

afterEach(() => {
	editor?.destroy();
	editor = undefined;
});

describe('reading the headings', () => {
	it('finds them in the order they appear', () => {
		const outline = outlineOf('<h1>One</h1><p>text</p><h2>Two</h2><h1>Three</h1>');

		expect(outline.map((h) => h.text)).toEqual(['One', 'Two', 'Three']);
		expect(outline.map((h) => h.level)).toEqual([1, 2, 1]);
	});

	it('reads a heading that contains formatting', () => {
		// `textContent` rather than the child nodes: a bold run or a citation in a
		// heading would otherwise contribute nothing to its label.
		const outline = outlineOf('<h2>The <strong>rising</strong> sea</h2>');

		expect(outline[0].text).toBe('The rising sea');
	});

	it('gives back nothing for a document with no headings', () => {
		// The honest answer. An empty panel says "no headings", where a fabricated
		// entry would say the outline is broken.
		expect(outlineOf('<p>just prose</p>')).toEqual([]);
	});

	it('carries a position that can be navigated to', () => {
		const outline = outlineOf('<p>before</p><h1>Target</h1>');

		expect(outline[0].pos).toBeGreaterThan(0);
	});
});

describe('indenting the outline', () => {
	it('starts a paper at the left even when its top level is h2', () => {
		// Most papers put the title outside the body, so the first real heading is
		// `##`. Indenting on the absolute level would leave the whole outline
		// pushed right with nothing at the root.
		const outline = outlineOf('<h2>Method</h2><h3>Participants</h3>');

		expect(outline.map((h) => h.depth)).toEqual([0, 1]);
	});

	it('indents by the levels used, not the levels skipped', () => {
		// h1 then h3, with no h2 anywhere: the h3 is one step in, not two, because
		// the empty step reads as a heading someone forgot to write.
		const outline = outlineOf('<h1>Paper</h1><h3>Detail</h3>');

		expect(outline.map((h) => h.depth)).toEqual([0, 1]);
	});

	it('keeps three used levels three deep', () => {
		const outline = outlineOf('<h1>A</h1><h2>B</h2><h3>C</h3>');

		expect(outline.map((h) => h.depth)).toEqual([0, 1, 2]);
	});
});

describe('where the reader is', () => {
	const headings: Heading[] = [
		{ pos: 0, level: 1, text: 'One', depth: 0 },
		{ pos: 100, level: 1, text: 'Two', depth: 0 },
		{ pos: 200, level: 1, text: 'Three', depth: 0 }
	];

	it('is the section they are inside, not the heading nearest them', () => {
		// At 190 the next heading is ten away and the current one ninety, but the
		// reader is still in section Two. Nearest-heading would jump ahead early
		// and make the highlight jitter as they scroll.
		expect(headingAt(headings, 190)?.text).toBe('Two');
	});

	it('is the heading itself when sitting on one', () => {
		expect(headingAt(headings, 100)?.text).toBe('Two');
	});

	it('is nothing above the first heading', () => {
		expect(headingAt(headings, -1)).toBeNull();
	});

	it('stays on the last section past the end', () => {
		expect(headingAt(headings, 9999)?.text).toBe('Three');
	});
});

describe('noticing a change', () => {
	const outline: Heading[] = [{ pos: 0, level: 1, text: 'One', depth: 0 }];

	it('sees no change when nothing moved', () => {
		// Typing inside a paragraph cannot alter the outline, and republishing on
		// every keystroke would re-render the panel for nothing.
		expect(sameOutline(outline, [{ pos: 0, level: 1, text: 'One', depth: 0 }])).toBe(true);
	});

	it('sees a renamed heading', () => {
		expect(sameOutline(outline, [{ pos: 0, level: 1, text: 'Renamed', depth: 0 }])).toBe(false);
	});

	it('sees a heading that moved', () => {
		// Text before a heading changes its position, and navigation uses that
		// position — a stale one scrolls to the wrong place.
		expect(sameOutline(outline, [{ pos: 42, level: 1, text: 'One', depth: 0 }])).toBe(false);
	});

	it('sees a level change', () => {
		expect(sameOutline(outline, [{ pos: 0, level: 2, text: 'One', depth: 0 }])).toBe(false);
	});

	it('sees one added or removed', () => {
		expect(sameOutline(outline, [])).toBe(false);
	});
});
