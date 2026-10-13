import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { parseCitationIds } from '$lib/citations/document';
import { BIBLIOGRAPHY_NODE } from '$lib/editor/extensions/citation/Bibliography';
import { NOTES_NODE } from '$lib/editor/extensions/citation/Notes';
import { sentenceRanges } from '$lib/ingest/chunk';

/**
 * The manuscript's sentences, for the attribution check (M4-2, ADR 006).
 *
 * The check indexes the manuscript sentence by sentence and reports against a
 * sentence, so each one carries where it sits in the document: a finding has
 * to be highlighted, and a fix has to land in the right place (M4-5, M4-6).
 *
 * Sentences are split by the rules ingest splits the corpus with, so the two
 * sides of a match are cut the same way.
 */

const CITATION_NODE = 'citation';

/**
 * Nodes whose text is not the writer's prose. The reference list and the
 * endnotes are citeproc's words, and match every source they name. Code is not
 * sentences at all.
 */
const SKIPPED = new Set([BIBLIOGRAPHY_NODE, NOTES_NODE, 'codeBlock']);

export interface SentenceCitation {
	/** Where the citation node sits in the document. */
	at: number;
	/** The works it cites, by canonical id (ADR 003). */
	ids: string[];
}

export interface Sentence {
	/** The sentence as written, with its citations left out. */
	text: string;
	/** Document position of its first character. */
	from: number;
	/** Document position just after its last character. */
	to: number;
	/**
	 * Citations inside the sentence, or after it and before the next one begins:
	 * "as shown.[1] Next" cites the first sentence, as a reader takes it.
	 */
	citations: SentenceCitation[];
	/**
	 * Inside a block quotation, which marks a quotation without quotation
	 * marks, so the classifier must not read it as unquoted (M4-4).
	 */
	quoted: boolean; /**
	 * The document position of each UTF-16 unit of `text`, so a fix can find
	 * words inside the sentence: they jump over a citation, which `text`
	 * leaves out (M4-6).
	 */
	positions: number[];
}

/** Every sentence of the writer's prose, in document order. */
export function walkSentences(doc: ProseMirrorNode): Sentence[] {
	const sentences: Sentence[] = [];
	walkBlocks(doc, 0, false, sentences);
	return sentences;
}

function walkBlocks(
	parent: ProseMirrorNode,
	contentStart: number,
	quoted: boolean,
	out: Sentence[]
): void {
	parent.forEach((child, offset) => {
		const pos = contentStart + offset;
		if (SKIPPED.has(child.type.name)) return;

		if (child.isTextblock) {
			readTextblock(child, pos + 1, quoted, out);
		} else if (!child.isLeaf) {
			walkBlocks(child, pos + 1, quoted || child.type.name === 'blockquote', out);
		}
	});
}

/**
 * One paragraph, heading or cell.
 *
 * A sentence never crosses a block. A table cell, a list item and a heading
 * rarely end in a full stop, so read as one run of text they would join into
 * a sentence no one wrote.
 */
function readTextblock(
	block: ProseMirrorNode,
	contentStart: number,
	quoted: boolean,
	out: Sentence[]
): void {
	let text = '';
	// The document position of each character of `text`.
	const positions: number[] = [];
	const citations: Array<SentenceCitation & { offset: number }> = [];

	block.forEach((child, offset) => {
		const pos = contentStart + offset;

		if (child.isText) {
			const value = child.text ?? '';
			for (let i = 0; i < value.length; i++) positions.push(pos + i);
			text += value;
		} else if (child.type.name === CITATION_NODE) {
			citations.push({ offset: text.length, at: pos, ids: parseCitationIds(child.attrs.id) });
		} else {
			// A line break or an inline image still separates the words either side.
			positions.push(pos);
			text += ' ';
		}
	});

	// A heading is a title, not prose: "2. Related work" is one line, not a
	// sentence "2." followed by another.
	const ranges = block.type.name === 'heading' ? wholeRange(text) : sentenceRanges(text);

	const first = out.length;
	for (const [start, end] of ranges) {
		out.push({
			text: text.slice(start, end),
			from: positions[start],
			to: positions[end - 1] + 1,
			citations: [],
			quoted,
			positions: positions.slice(start, end)
		});
	}

	if (out.length === first) return;
	for (const { offset, at, ids } of citations) {
		// The last sentence to start at or before the citation; one that opens the
		// block goes with the first.
		let index = first;
		for (let i = first; i < out.length && ranges[i - first][0] <= offset; i++) index = i;
		out[index].citations.push({ at, ids });
	}
}

function wholeRange(text: string): Array<[number, number]> {
	const start = text.length - text.trimStart().length;
	const end = text.trimEnd().length;
	return end > start ? [[start, end]] : [];
}
