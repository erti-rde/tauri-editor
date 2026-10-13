import type { Editor } from '@tiptap/core';
import { findWrapping } from '@tiptap/pm/transform';

import { wordOffsets } from '$lib/attribution/findings';
import { walkSentences, type Sentence } from '$lib/attribution/sentences';

import { citeWork } from './citeWork';
import {
	markRanges,
	rangeOf as trackedRange,
	selectRange,
	type MarkedRange
} from './extensions/CheckMarks';

/**
 * How the Check panel reaches the manuscript (M4-5, M4-6).
 *
 * The panel and the editor are siblings, as with the outline and the notes
 * panel, so the editor hands this over and the panel calls it. It reads the
 * sentences, tracks each finding's sentence through edits, underlines the one
 * selected, and makes the fixes.
 *
 * A fix acts only on the sentence as it was checked: each takes the text the
 * check read and does nothing if the sentence now says something else, since
 * the word offsets it carries would point at the wrong words.
 */
export interface CheckEditor {
	/** The open manuscript's file name, which the check leaves out of its corpus. */
	document(): string | null;
	sentences(): Sentence[];
	/** Track these sentences, replacing any tracked before. */
	mark(ranges: MarkedRange[]): void;
	/** Where a tracked sentence is now, or null once it has gone. */
	rangeOf(id: string): { from: number; to: number } | null;
	/** Underline one tracked sentence, or none, and scroll to it. */
	select(id: string | null): void;
	/** The sentence a tracked finding is in now. */
	sentenceOf(id: string): Sentence | null;
	/** While a fix is editing: its edits don't make the check stale. */
	readonly fixing: boolean;

	/** Cite `work` at the end of the sentence, before its full stop. */
	cite(id: string, checked: string, work: string, locator?: string): Promise<boolean>;
	/** Put quotation marks round a range of the sentence's words, and cite after them. */
	quoteAndCite(
		id: string,
		checked: string,
		words: [number, number],
		work: string,
		locator?: string
	): Promise<boolean>;
	/** Make the sentence a block quotation of its own, cited at its end. */
	blockQuote(id: string, checked: string, work: string, locator?: string): Promise<boolean>;
	/** Replace `[start, end)` of the sentence's text. */
	replace(id: string, checked: string, at: [number, number], text: string): boolean;
}

type Cite = (editor: Editor, work: string, locator?: string) => Promise<void>;

/** Sentence-ending punctuation, and any closing marks after it. */
const ENDING = /[.!?…]+["”’»)]*\s*$/u;
/**
 * The space a citation brings after it, where it isn't wanted: before
 * punctuation, before the space already there, or at the end of the block.
 */
const SPARE_SPACE = /^ ([.,;:!?…)\]\s]|$)/u;

export function checkEditor(
	editor: Editor,
	document: () => string | null,
	cite: Cite = citeWork
): CheckEditor {
	let fixing = false;

	const sentenceOf = (id: string): Sentence | null => {
		const range = trackedRange(editor.state, id);
		if (!range) return null;
		const sentences = walkSentences(editor.state.doc);
		return (
			sentences.find((s) => s.from === range.from && s.to === range.to) ??
			sentences.find((s) => s.from <= range.from && range.from < s.to) ??
			null
		);
	};

	/** The sentence, if it still reads as it did when checked. */
	const unchanged = (id: string, checked: string) => {
		const sentence = sentenceOf(id);
		return sentence && sentence.text === checked ? sentence : null;
	};

	/** Document position of the start of character `offset`, and just past `end - 1`. */
	const span = (s: Sentence, [start, end]: [number, number]) => ({
		from: s.positions[start],
		to: s.positions[end - 1] + 1
	});

	/** Run `edit` as a fix: its edits aren't the writer's, so the check stays current. */
	async function asFix<T>(edit: () => Promise<T> | T): Promise<T> {
		fixing = true;
		try {
			return await edit();
		} finally {
			fixing = false;
		}
	}

	/**
	 * Cite at `pos`, through the same path every other citation takes
	 * (`citeWork`), then close the gap it leaves before punctuation.
	 */
	async function citeAt(pos: number, work: string, locator?: string): Promise<boolean> {
		const before = editor.state.doc;
		editor.commands.setTextSelection(pos);
		await cite(editor, work, locator);
		if (editor.state.doc.eq(before)) return false;

		const { doc } = editor.state;
		let after: number | null = null;
		doc.nodesBetween(pos, Math.min(pos + 3, doc.content.size), (node, at) => {
			if (after === null && node.type.name === 'citation') after = at + node.nodeSize;
		});
		const blockEnd = doc.resolve(pos).end();
		if (after !== null && SPARE_SPACE.test(doc.textBetween(after, Math.min(after + 2, blockEnd)))) {
			editor.view.dispatch(editor.state.tr.delete(after, after + 1));
		}
		return true;
	}

	return {
		document,
		sentences: () => walkSentences(editor.state.doc),
		mark: (ranges) => markRanges(editor.view, ranges),
		rangeOf: (id) => trackedRange(editor.state, id),
		sentenceOf,

		select(id) {
			selectRange(editor.view, id);
			if (id === null) return;
			const range = trackedRange(editor.state, id);
			if (!range) return;
			// Into view, centred, without moving the writer's cursor: looking at a
			// finding isn't starting to edit it. Up and down only: in a split the
			// page is wider than its pane, and the writer's sideways place stays.
			scrollToCentre(editor.view.dom, () => editor.view.coordsAtPos(range.from));
		},

		get fixing() {
			return fixing;
		},

		cite: (id, checked, work, locator) =>
			asFix(async () => {
				const s = unchanged(id, checked);
				if (!s) return false;
				const ending = ENDING.exec(s.text);
				const pos = ending && ending.index > 0 ? s.positions[ending.index] : s.to;
				return citeAt(pos, work, locator);
			}),

		quoteAndCite: (id, checked, words, work, locator) =>
			asFix(async () => {
				const s = unchanged(id, checked);
				const at = s && wordOffsets(s.text, words);
				if (!s || !at) return false;
				const { from, to } = span(s, at);
				// The closing mark first, so the opening one doesn't move it.
				editor.view.dispatch(editor.state.tr.insertText('”', to).insertText('“', from));
				return citeAt(to + 2, work, locator);
			}),

		blockQuote: (id, checked, work, locator) =>
			asFix(async () => {
				const s = unchanged(id, checked);
				if (!s) return false;
				const { state } = editor;
				const blockquote = state.schema.nodes.blockquote;
				const $from = state.doc.resolve(s.from);
				const start = $from.start();
				const end = $from.end();
				// A citation just after the sentence goes with it, as the walk reads it.
				const last = Math.max(s.to, ...s.citations.map((c) => c.at + 1));
				const tr = state.tr;

				// The rest of the paragraph after it becomes a paragraph of its own.
				const after = state.doc.textBetween(last, end, ' ', ' ');
				if (after.trim()) {
					const lead = after.length - after.trimStart().length;
					tr.delete(last, last + lead).split(last);
				}
				// And what's before it, without the space between.
				let from = s.from;
				const before = state.doc.textBetween(start, s.from, ' ', ' ');
				if (before.trim()) {
					const trail = before.length - before.trimEnd().length;
					tr.delete(s.from - trail, s.from).split(s.from - trail);
					from = s.from - trail + 2;
				}

				const range = tr.doc.resolve(from).blockRange();
				const wrapping = range && findWrapping(range, blockquote);
				if (!range || !wrapping) return false;
				tr.wrap(range, wrapping);
				editor.view.dispatch(tr);

				// `from` is already past the splits; the wrapping adds one more step.
				return citeAt(editor.state.doc.resolve(from + 1).end(), work, locator);
			}),

		replace(id, checked, at, text) {
			fixing = true;
			try {
				const s = unchanged(id, checked);
				if (!s || at[0] >= at[1]) return false;
				const { from, to } = span(s, at);
				editor.view.dispatch(editor.state.tr.insertText(text, from, to));
				return true;
			} finally {
				fixing = false;
			}
		}
	};
}

/** Scroll the nearest scrolling ancestor of `dom` so `at` sits mid-height. */
function scrollToCentre(dom: HTMLElement, at: () => { top: number; bottom: number }) {
	let scroller: HTMLElement | null = dom.parentElement;
	while (scroller) {
		const { overflowY } = getComputedStyle(scroller);
		if (/(auto|scroll)/.test(overflowY) && scroller.scrollHeight > scroller.clientHeight) break;
		scroller = scroller.parentElement;
	}
	if (!scroller) return;
	try {
		const { top, bottom } = at();
		const box = scroller.getBoundingClientRect();
		scroller.scrollTop += (top + bottom) / 2 - (box.top + box.height / 2);
	} catch {
		// No layout to measure (a document not yet drawn): nothing to scroll.
	}
}
