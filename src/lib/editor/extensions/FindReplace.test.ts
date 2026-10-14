import { afterEach, describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';

import { Editor } from '$lib/editor/core/Editor';
import { editorExtensions } from '$lib/editor/core/extensions';
import {
	closeFind,
	findMatches,
	findState,
	replaceAll,
	replaceCurrent,
	search,
	step,
	type FindOptions
} from './FindReplace';

let editor: Editor | undefined;

function makeEditor(content: string | JSONContent) {
	editor = new Editor({
		element: document.createElement('div'),
		extensions: editorExtensions,
		content
	});
	return editor;
}

afterEach(() => {
	editor?.destroy();
	editor = undefined;
});

const ANY: FindOptions = { caseSensitive: false, wholeWord: false };

/** The text of each match, as found. */
function found(instance: Editor, query: string, options: FindOptions = ANY) {
	return findMatches(instance.state.doc, query, options).map(({ from, to }) =>
		instance.state.doc.textBetween(from, to)
	);
}

const cited = (before: string, label: string, after: string): JSONContent => ({
	type: 'doc',
	content: [
		{
			type: 'paragraph',
			content: [
				{ type: 'text', text: before },
				{ type: 'citation', attrs: { id: 'vaswani2017', label } },
				{ type: 'text', text: after }
			]
		}
	]
});

const marked = (instance: Editor) =>
	[...instance.view.dom.querySelectorAll('.erti-find-match')].map((el) => ({
		text: el.textContent,
		current: el.classList.contains('erti-find-current')
	}));

describe('finding', () => {
	// M5-2 AC-2
	it('ignores case unless asked to match it', () => {
		const instance = makeEditor('<p>Attention is all. Self-attention, ATTENTION.</p>');

		expect(found(instance, 'attention')).toEqual(['Attention', 'attention', 'ATTENTION']);
		expect(found(instance, 'attention', { ...ANY, caseSensitive: true })).toEqual(['attention']);
	});

	// M5-2 AC-2
	it('finds whole words only when asked, in any script', () => {
		const instance = makeEditor('<p>art, artist, the art. ერთი ერთიანი; café cafés</p>');
		const whole = { ...ANY, wholeWord: true };

		expect(found(instance, 'art')).toHaveLength(3);
		expect(found(instance, 'art', whole)).toEqual(['art', 'art']);
		expect(found(instance, 'ერთი', whole)).toEqual(['ერთი']);
		expect(found(instance, 'café', whole)).toEqual(['café']);
	});

	it('reads a word across bold and italic as one word', () => {
		const instance = makeEditor('<p>self-<strong>atten</strong><em>tion</em> layers</p>');

		expect(found(instance, 'self-attention')).toEqual(['self-attention']);
	});

	it('takes the query literally', () => {
		const instance = makeEditor('<p>p < .05 (n = 12) costs $3.50 [sic] a+b</p>');

		expect(found(instance, '(n = 12)')).toEqual(['(n = 12)']);
		expect(found(instance, '$3.50')).toEqual(['$3.50']);
		expect(found(instance, '[sic]')).toEqual(['[sic]']);
		expect(found(instance, 'a+b')).toEqual(['a+b']);
		expect(found(instance, '.')).toHaveLength(2);
	});

	it('finds in headings, lists and tables', () => {
		const instance = makeEditor(
			'<h2>Method</h2><ul><li><p>a method</p></li></ul>' +
				'<table><tr><td><p>method</p></td></tr></table>'
		);

		expect(found(instance, 'method')).toHaveLength(3);
	});

	it('finds nothing for nothing', () => {
		const instance = makeEditor('<p>Some words.</p>');

		expect(found(instance, '')).toEqual([]);
		expect(found(instance, '￼')).toEqual([]);
	});

	// M5-2 AC-3
	it('never matches inside a citation, nor across one', () => {
		const instance = makeEditor(cited('As Vaswani showed ', '(Vaswani et al., 2017)', ' again'));

		expect(found(instance, 'Vaswani')).toEqual(['Vaswani']);
		expect(found(instance, '2017')).toEqual([]);
		expect(found(instance, 'showed  again')).toEqual([]);
		expect(found(instance, 'showed (Vaswani')).toEqual([]);
	});
});

describe('the find bar’s matches in the editor', () => {
	// M5-2 AC-2
	it('highlights every match, and the one nearest the cursor as current', () => {
		const instance = makeEditor('<p>one two one two one</p>');
		instance.commands.setTextSelection(6);

		search(instance.view, 'one', ANY);

		expect(findState(instance.state)).toMatchObject({ current: 1 });
		expect(marked(instance)).toEqual([
			{ text: 'one', current: false },
			{ text: 'one', current: true },
			{ text: 'one', current: false }
		]);
	});

	// M5-2 AC-2
	it('goes to the next and previous match, round the ends, selecting it', () => {
		const instance = makeEditor('<p>one two one two one</p>');
		instance.commands.setTextSelection(1);
		search(instance.view, 'one', ANY);

		step(instance.view, 1);
		expect(findState(instance.state).current).toBe(1);
		expect(instance.state.selection).toMatchObject({ from: 9, to: 12 });
		step(instance.view, 1);
		step(instance.view, 1);
		expect(findState(instance.state).current).toBe(0);
		step(instance.view, -1);
		expect(findState(instance.state).current).toBe(2);
	});

	it('follows the text as it changes, and undo never sees the search', () => {
		const instance = makeEditor('<p>one two</p>');
		search(instance.view, 'two', ANY);
		instance.commands.insertContentAt(1, 'two ');

		expect(findState(instance.state).matches).toHaveLength(2);
		instance.commands.undo();
		expect(instance.getText()).toBe('one two');
		expect(findState(instance.state).matches).toHaveLength(1);
	});

	it('is never part of the document', () => {
		const instance = makeEditor('<p>one two one</p>');
		const before = instance.getJSON();

		search(instance.view, 'one', ANY);

		expect(instance.getJSON()).toEqual(before);
		expect(instance.getHTML()).not.toContain('erti-find');
	});

	// M5-2 AC-1
	it('clears the highlights when closed', () => {
		const instance = makeEditor('<p>one two one</p>');
		search(instance.view, 'one', ANY);

		closeFind(instance.view);

		expect(marked(instance)).toEqual([]);
		expect(findState(instance.state).query).toBe('');
	});
});

describe('replacing', () => {
	it('replaces the current match in its marks, and moves to the next', () => {
		const instance = makeEditor('<p><strong>colour</strong> and colour</p>');
		instance.commands.setTextSelection(1);
		search(instance.view, 'colour', ANY);

		replaceCurrent(instance.view, 'color');

		expect(instance.getHTML()).toBe('<p><strong>color</strong> and colour</p>');
		expect(findState(instance.state)).toMatchObject({ current: 0 });
		expect(
			instance.state.doc.textBetween(instance.state.selection.from, instance.state.selection.to)
		).toBe('colour');
	});

	it('doesn’t find its own replacement again', () => {
		const instance = makeEditor('<p>cat, cat</p>');
		instance.commands.setTextSelection(1);
		search(instance.view, 'cat', ANY);

		replaceCurrent(instance.view, 'cats');
		replaceCurrent(instance.view, 'cats');

		expect(instance.getText()).toBe('cats, cats');
	});

	// M5-2 AC-3
	it('replaces all as one step for undo, even straight after typing', () => {
		const instance = makeEditor('<p>colour, colour and colour</p>');
		// Typed right against the last match, which undo would join to the next
		// edit there if it came within half a second.
		instance.commands.insertContentAt(instance.state.doc.content.size - 1, 's');
		search(instance.view, 'colour', ANY);

		expect(replaceAll(instance.view, 'color')).toBe(3);
		expect(instance.getText()).toBe('color, color and colors');

		instance.commands.undo();
		expect(instance.getText()).toBe('colour, colour and colours');
	});

	// M5-2 AC-3
	it('leaves citations as they were', () => {
		const content = cited('Vaswani ', 'Vaswani (2017)', ' Vaswani');
		const instance = makeEditor(content);
		search(instance.view, 'Vaswani', ANY);

		replaceAll(instance.view, 'V.');

		const paragraph: JSONContent[] = instance.getJSON().content![0].content!;
		expect(paragraph.map((node) => node.text ?? node.attrs?.label)).toEqual([
			'V. ',
			'Vaswani (2017)',
			' V.'
		]);
	});

	it('can replace with nothing', () => {
		const instance = makeEditor('<p>very very good</p>');
		search(instance.view, 'very ', ANY);

		replaceAll(instance.view, '');

		expect(instance.getText()).toBe('good');
	});

	it('changes nothing in a document open read-only', () => {
		const instance = makeEditor('<p>colour</p>');
		instance.setEditable(false);
		search(instance.view, 'colour', ANY);

		expect(replaceAll(instance.view, 'color')).toBe(0);
		replaceCurrent(instance.view, 'color');
		expect(instance.getText()).toBe('colour');
	});
});
