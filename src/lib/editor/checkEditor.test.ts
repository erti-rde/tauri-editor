import { afterEach, describe, expect, it } from 'vitest';
import type { Editor as TiptapEditor, JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { Editor } from '$lib/editor/core/Editor';
import { editorExtensions } from '$lib/editor/core/extensions';

import { checkEditor, type CheckEditor } from './checkEditor';

/**
 * The bridge between the Check panel and the manuscript, against a real
 * editor: positions, splits and wrapping are ProseMirror's, and a stub would
 * only prove the bridge agrees with itself.
 */

let editor: Editor | undefined;
let host: HTMLElement | undefined;

/** Cites as `citeWork` would, without the project's citation store. */
async function cite(instance: TiptapEditor, work: string, locator?: string) {
	instance.commands.insertCitation({
		id: JSON.stringify([work]),
		label: `(${work})`,
		locators: locator ? { [work]: locator } : null
	});
}

function open(content: JSONContent[]): CheckEditor {
	host = document.createElement('div');
	document.body.append(host);
	editor = new Editor({
		element: host,
		extensions: editorExtensions,
		content: { type: 'doc', content }
	});
	return checkEditor(editor, () => 'chapter-1.erti.json', cite);
}

afterEach(() => {
	editor?.destroy();
	host?.remove();
	editor = undefined;
	host = undefined;
});

const para = (...text: string[]): JSONContent => ({
	type: 'paragraph',
	content: text.map((t) => ({ type: 'text', text: t }))
});

/** The document as text, a block a line, citations as `[work p]`. */
function read(doc: ProseMirrorNode = editor!.state.doc): string[] {
	const lines: string[] = [];
	doc.descendants((node) => {
		if (!node.isTextblock) return true;
		let line = '';
		node.forEach((child) => {
			if (child.isText) line += child.text;
			else if (child.type.name === 'citation') {
				const [work] = JSON.parse(child.attrs.id);
				const page = child.attrs.locators?.[work];
				line += `[${work}${page ? ` ${page}` : ''}]`;
			}
		});
		lines.push(isQuoted(doc, node) ? `> ${line}` : line);
		return false;
	});
	return lines;
}

function isQuoted(doc: ProseMirrorNode, target: ProseMirrorNode): boolean {
	let found = false;
	doc.descendants((node, pos) => {
		if (node !== target) return true;
		const $pos = doc.resolve(pos);
		for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === 'blockquote') found = true;
		return false;
	});
	return found;
}

const FIRST = 'Recurrent models dominated sequence transduction for years.';
const SECOND = 'Attention mechanisms let a model weigh every position at once.';
const THIRD = 'Later work built on that idea.';

/** Track every sentence as `s0`, `s1`, … and return the bridge. */
function tracked(bridge: CheckEditor) {
	const sentences = bridge.sentences();
	bridge.mark(sentences.map((s, i) => ({ id: `s${i}`, from: s.from, to: s.to })));
	return sentences;
}

describe('marking a finding’s sentence', () => {
	// M4-5 AC-4
	it('underlines only the selected sentence, and follows it through edits above', () => {
		const bridge = open([para(`${FIRST} ${SECOND} ${THIRD}`)]);
		tracked(bridge);

		bridge.select('s1');
		const underlined = () =>
			[...editor!.view.dom.querySelectorAll('.erti-check-sentence')].map((e) => e.textContent);
		expect(underlined()).toEqual([SECOND]);

		// Typed above it: the mark moves with the sentence.
		editor!.view.dispatch(editor!.state.tr.insertText('Indeed, ', 1));
		expect(underlined()).toEqual([SECOND]);
		expect(bridge.sentenceOf('s1')?.text).toBe(SECOND);

		bridge.select(null);
		expect(underlined()).toEqual([]);
	});

	// M4-5 AC-4
	it('forgets a sentence once it has been deleted', () => {
		const bridge = open([para(FIRST), para(SECOND)]);
		const [, second] = tracked(bridge);
		editor!.view.dispatch(editor!.state.tr.delete(second.from - 1, second.to + 1));
		expect(bridge.rangeOf('s1')).toBeNull();
		expect(bridge.sentenceOf('s1')).toBeNull();
	});
});

describe('fixing a finding', () => {
	// M4-6 AC-1
	it('cites at the end of the sentence, before its full stop', async () => {
		const bridge = open([para(`${FIRST} ${SECOND}`)]);
		tracked(bridge);

		expect(await bridge.cite('s0', FIRST, 'vaswani', '2')).toBe(true);
		expect(read()).toEqual([
			'Recurrent models dominated sequence transduction for years [vaswani 2]. ' + SECOND
		]);
	});

	// M4-6 AC-1
	it('quotes the matched words and cites after the closing mark', async () => {
		const bridge = open([para(SECOND)]);
		tracked(bridge);

		// "let a model weigh every position"
		expect(await bridge.quoteAndCite('s0', SECOND, [2, 8], 'bahdanau', '4')).toBe(true);
		expect(read()).toEqual([
			'Attention mechanisms “let a model weigh every position” [bahdanau 4] at once.'
		]);
	});

	// M4-6 AC-1
	it('makes a sentence in the middle of a paragraph a block quotation of its own', async () => {
		const bridge = open([para(`${FIRST} ${SECOND} ${THIRD}`)]);
		tracked(bridge);

		expect(await bridge.blockQuote('s1', SECOND, 'bahdanau')).toBe(true);
		expect(read()).toEqual([FIRST, `> ${SECOND} [bahdanau]`, THIRD]);
	});

	// M4-6 AC-1
	it('makes a whole paragraph a block quotation without splitting it', async () => {
		const bridge = open([para(FIRST), para(SECOND)]);
		tracked(bridge);

		expect(await bridge.blockQuote('s1', SECOND, 'bahdanau', '7')).toBe(true);
		// The editor keeps a paragraph after a quotation that ends the document,
		// so there's somewhere to type.
		expect(read()).toEqual([FIRST, `> ${SECOND} [bahdanau 7]`, '']);
	});

	// M4-6 AC-1
	it('replaces words of the sentence', () => {
		const sentence = 'They reported results on “eleven natural language tasks” in all.';
		const bridge = open([para(sentence)]);
		tracked(bridge);

		const start = sentence.indexOf('eleven');
		const end = sentence.indexOf('” in');
		expect(
			bridge.replace('s0', sentence, [start, end], 'eleven natural language processing tasks')
		).toBe(true);
		expect(read()).toEqual([
			'They reported results on “eleven natural language processing tasks” in all.'
		]);
	});

	// M4-6 AC-2
	it('does nothing when the sentence no longer reads as it was checked', async () => {
		const bridge = open([para(FIRST)]);
		tracked(bridge);
		editor!.view.dispatch(editor!.state.tr.insertText(' still', 17));
		const before = read();

		expect(await bridge.cite('s0', FIRST, 'vaswani')).toBe(false);
		expect(await bridge.quoteAndCite('s0', FIRST, [0, 3], 'vaswani')).toBe(false);
		expect(await bridge.blockQuote('s0', FIRST, 'vaswani')).toBe(false);
		expect(bridge.replace('s0', FIRST, [0, 3], 'x')).toBe(false);
		expect(read()).toEqual(before);
	});

	// M4-5 AC-5
	it('says it is fixing while its edits are made, and only then', async () => {
		const bridge = open([para(FIRST)]);
		tracked(bridge);
		const seen: boolean[] = [];
		editor!.on('update', () => seen.push(bridge.fixing));

		await bridge.cite('s0', FIRST, 'vaswani');
		expect(seen.length).toBeGreaterThan(0);
		expect(seen.every(Boolean)).toBe(true);
		expect(bridge.fixing).toBe(false);
	});
});
