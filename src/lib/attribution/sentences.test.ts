import { afterEach, describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { Editor } from '$lib/editor/core/Editor';
import { editorExtensions } from '$lib/editor/core/extensions';
import { sentenceRanges, splitSentences } from '$lib/ingest/chunk';
import { walkSentences, type Sentence } from './sentences';

/**
 * Built against a real editor, as the outline and draft-context tests are: what
 * is walked is a ProseMirror document, and a hand-made one would only prove the
 * walk matches the stub.
 */

let editor: Editor | undefined;

function docOf(content: JSONContent[]): ProseMirrorNode {
	editor = new Editor({
		element: document.createElement('div'),
		extensions: editorExtensions,
		content: { type: 'doc', content }
	});
	return editor.state.doc;
}

afterEach(() => {
	editor?.destroy();
	editor = undefined;
});

const text = (value: string): JSONContent => ({ type: 'text', text: value });
const cite = (...ids: string[]): JSONContent => ({
	type: 'citation',
	attrs: { id: JSON.stringify(ids) }
});
const para = (...content: Array<string | JSONContent>): JSONContent => ({
	type: 'paragraph',
	content: content.map((part) => (typeof part === 'string' ? text(part) : part))
});
const heading = (value: string, level = 2): JSONContent => ({
	type: 'heading',
	attrs: { level },
	content: [text(value)]
});
const texts = (sentences: Sentence[]) => sentences.map((s) => s.text);

/** What the document holds between a sentence's positions, citations left out. */
function between(doc: ProseMirrorNode, sentence: Sentence): string {
	return doc.textBetween(sentence.from, sentence.to, '\n', (leaf) =>
		leaf.type.name === 'citation' ? '' : ' '
	);
}

/** Every sentence's positions hold exactly its text. */
function expectPositionsHold(doc: ProseMirrorNode, sentences: Sentence[]) {
	for (const sentence of sentences) expect(between(doc, sentence)).toBe(sentence.text);
}

describe('walking a document into sentences', () => {
	// M4-2 AC-1
	it('gives each sentence with the positions it sits at', () => {
		const doc = docOf([
			para('The first claim is made here. A second follows it.'),
			para('A new paragraph opens.')
		]);

		const sentences = walkSentences(doc);

		expect(texts(sentences)).toEqual([
			'The first claim is made here.',
			'A second follows it.',
			'A new paragraph opens.'
		]);
		expectPositionsHold(doc, sentences);
		// The first paragraph's text starts just inside it.
		expect(sentences[0].from).toBe(1);
		expect(sentences[0].to).toBe(1 + 'The first claim is made here.'.length);
	});

	// M4-2 AC-1
	it('leaves citations out of the text, and records them on the sentence', () => {
		const doc = docOf([
			para(
				'Attention is all you need ',
				cite('arxiv:1706.03762'),
				'. Others built on it',
				cite('doi:10.1/a', 'doi:10.1/b'),
				'.'
			)
		]);

		const sentences = walkSentences(doc);

		expect(texts(sentences)).toEqual(['Attention is all you need .', 'Others built on it.']);
		expectPositionsHold(doc, sentences);
		expect(sentences[0].citations.map((c) => c.ids)).toEqual([['arxiv:1706.03762']]);
		expect(sentences[1].citations.map((c) => c.ids)).toEqual([['doi:10.1/a', 'doi:10.1/b']]);
		// `at` is the citation node itself.
		for (const sentence of sentences) {
			for (const { at } of sentence.citations) {
				expect(doc.nodeAt(at)?.type.name).toBe('citation');
			}
		}
	});

	// M4-2 AC-1
	it('gives a citation after the full stop to the sentence it follows', () => {
		const doc = docOf([
			para(
				'Notes come after the stop.',
				cite('isbn:9780000000001'),
				' The next sentence cites nothing.'
			)
		]);

		const sentences = walkSentences(doc);

		expect(sentences[0].citations.map((c) => c.ids)).toEqual([['isbn:9780000000001']]);
		expect(sentences[1].citations).toEqual([]);
	});

	// M4-2 AC-1
	it('gives a citation that opens a paragraph to its first sentence', () => {
		const doc = docOf([para(cite('doi:10.1/a'), ' argues the point. Then more.')]);

		const sentences = walkSentences(doc);

		expect(texts(sentences)).toEqual(['argues the point.', 'Then more.']);
		expect(sentences[0].citations).toHaveLength(1);
		expect(sentences[1].citations).toHaveLength(0);
		expectPositionsHold(doc, sentences);
	});

	// M4-2 AC-1
	it('skips the reference list and the endnotes', () => {
		const doc = docOf([
			para('The body says one thing.'),
			{
				type: 'notes',
				attrs: { notes: [{ number: 1, text: 'Vaswani, Attention Is All You Need, 2017.' }] }
			},
			{
				type: 'bibliography',
				attrs: { entries: ['Vaswani, A. et al. (2017). Attention is all you need.'] }
			}
		]);

		expect(texts(walkSentences(doc))).toEqual(['The body says one thing.']);
	});

	// M4-2 AC-1
	it('skips code, which is not sentences', () => {
		const doc = docOf([
			para('Before the listing.'),
			{ type: 'codeBlock', content: [text('x = 1. Y = 2.')] },
			para('After it.')
		]);

		expect(texts(walkSentences(doc))).toEqual(['Before the listing.', 'After it.']);
	});

	// M4-2 AC-1
	it('says which sentences are inside a block quotation', () => {
		const doc = docOf([
			para('As the authors put it:'),
			{ type: 'blockquote', content: [para('The model is simple. It works.')] },
			para('That is the claim.')
		]);

		const sentences = walkSentences(doc);

		expect(sentences.map((s) => [s.text, s.quoted])).toEqual([
			['As the authors put it:', false],
			['The model is simple.', true],
			['It works.', true],
			['That is the claim.', false]
		]);
	});

	// M4-2 AC-1
	it('reads a line break as space between words', () => {
		const doc = docOf([
			{
				type: 'paragraph',
				content: [text('One line'), { type: 'hardBreak' }, text('runs on. Another.')]
			}
		]);

		const sentences = walkSentences(doc);

		expect(texts(sentences)).toEqual(['One line runs on.', 'Another.']);
		expectPositionsHold(doc, sentences);
	});

	// M4-2 AC-1
	it('finds nothing in an empty document, or in a paragraph of citations only', () => {
		expect(walkSentences(docOf([para()]))).toEqual([]);
		expect(walkSentences(docOf([para(cite('doi:10.1/a'), ' ', cite('doi:10.1/b'))]))).toEqual([]);
	});

	// M4-2 AC-1
	it('is pure: the same document gives the same sentences, and is left as it was', () => {
		const doc = docOf([para('Stable text. Read twice.', cite('doi:10.1/a'))]);
		const before = doc.toJSON();

		expect(walkSentences(doc)).toEqual(walkSentences(doc));
		expect(doc.toJSON()).toEqual(before);
	});
});

describe('splitting by the ingest rules', () => {
	// M4-2 AC-2
	it('keeps abbreviations, initials and decimals inside a sentence', () => {
		const doc = docOf([
			para(
				'Smith et al. showed a clear effect, e.g. in Fig. 2. Work by J. R. Smith settled it. ' +
					'The model explained 0.95 of the variance. That is high.'
			)
		]);

		expect(texts(walkSentences(doc))).toEqual([
			'Smith et al. showed a clear effect, e.g. in Fig. 2.',
			'Work by J. R. Smith settled it.',
			'The model explained 0.95 of the variance.',
			'That is high.'
		]);
	});

	// M4-2 AC-2
	it('splits a paragraph exactly as ingest splits the same text', () => {
		const value =
			'One claim. Another claim! A third? “Quoted words.” (A bracketed aside.) Final, cf. Ref. 4.';
		const doc = docOf([para(value)]);

		expect(texts(walkSentences(doc))).toEqual(splitSentences(value));
	});

	// M4-2 AC-2
	it('makes a heading one sentence, and never joins it to the text below', () => {
		const doc = docOf([
			heading('2. Related work'),
			para('Prior work exists. It is cited.'),
			heading('Results and discussion', 3),
			para('Without a full stop above')
		]);

		const sentences = walkSentences(doc);

		expect(texts(sentences)).toEqual([
			'2. Related work',
			'Prior work exists.',
			'It is cited.',
			'Results and discussion',
			'Without a full stop above'
		]);
		expectPositionsHold(doc, sentences);
	});

	// M4-2 AC-2
	it('keeps list items apart, though they end without a full stop', () => {
		const item = (value: string): JSONContent => ({ type: 'listItem', content: [para(value)] });
		const doc = docOf([
			{
				type: 'bulletList',
				content: [item('First point'), item('Second point. With two sentences')]
			},
			{ type: 'orderedList', content: [item('Numbered one'), item('Numbered two')] }
		]);

		const sentences = walkSentences(doc);

		expect(texts(sentences)).toEqual([
			'First point',
			'Second point.',
			'With two sentences',
			'Numbered one',
			'Numbered two'
		]);
		expectPositionsHold(doc, sentences);
	});

	// M4-2 AC-2
	it('keeps table cells apart, header and body', () => {
		const cell = (type: string, value: string): JSONContent => ({ type, content: [para(value)] });
		const doc = docOf([
			{
				type: 'table',
				content: [
					{
						type: 'tableRow',
						content: [cell('tableHeader', 'Model'), cell('tableHeader', 'Score')]
					},
					{
						type: 'tableRow',
						content: [
							cell('tableCell', 'Transformer base'),
							cell('tableCell', 'Reaches 27.3 BLEU. Best so far')
						]
					}
				]
			},
			para('The table shows it.')
		]);

		const sentences = walkSentences(doc);

		expect(texts(sentences)).toEqual([
			'Model',
			'Score',
			'Transformer base',
			'Reaches 27.3 BLEU.',
			'Best so far',
			'The table shows it.'
		]);
		expectPositionsHold(doc, sentences);
	});
});

describe('sentence ranges', () => {
	// M4-2 AC-2
	it('are the offsets of what splitSentences returns', () => {
		const samples = [
			'',
			'   ',
			'No full stop',
			'  Leading space. And trailing.  ',
			'Smith et al. showed it. J. R. Smith agreed.\nThen 0.5 of them left.',
			"Is it? Yes! (Bracketed.) “Quoted.” 'Single.' lower. Upper."
		];

		for (const sample of samples) {
			expect(sentenceRanges(sample).map(([s, e]) => sample.slice(s, e))).toEqual(
				splitSentences(sample)
			);
		}
	});
});
