import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import {
	Plugin,
	PluginKey,
	TextSelection,
	type EditorState,
	type Transaction
} from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/**
 * Find & replace in the manuscript (M5-2, docs/ux.md UX-11).
 *
 * Only the writer's own words are searched. A citation is an atom whose text
 * is drawn from the library, and the notes and the bibliography are generated
 * from the citations, so none of them is matched or replaced: each stands in
 * the searched text as one character no query can contain, so a match can't
 * run across a citation either.
 *
 * The matches are decorations, like the attribution marks: nothing here is
 * content, so it never reaches the saved file, an export or the undo history.
 */

export interface FindOptions {
	caseSensitive: boolean;
	wholeWord: boolean;
}

export interface Match {
	from: number;
	to: number;
}

export const findKey = new PluginKey<FindState>('findReplace');

interface FindState {
	query: string;
	options: FindOptions;
	matches: Match[];
	/** Which match is the current one, or -1 when there are none. */
	current: number;
}

const NO_OPTIONS: FindOptions = { caseSensitive: false, wholeWord: false };
const EMPTY: FindState = { query: '', options: NO_OPTIONS, matches: [], current: -1 };

/** What a citation, image or line break reads as: never typed, so never matched. */
const OBJECT = '￼';

/** A letter, digit or underscore in any script: where a whole word can't start or end. */
const WORD = '[\\p{L}\\p{N}\\p{M}_]';

function pattern(query: string, options: FindOptions): RegExp | null {
	const text = query.replaceAll(OBJECT, '');
	if (text === '') return null;
	const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const source = options.wholeWord ? `(?<!${WORD})${escaped}(?!${WORD})` : escaped;
	return new RegExp(source, options.caseSensitive ? 'gu' : 'giu');
}

/**
 * Every match in reading order. Each textblock is read as one string whose
 * offsets are positions in the document: a text node is its characters, and
 * any other inline node is one position, read as one object character.
 */
export function findMatches(doc: ProseMirrorNode, query: string, options: FindOptions): Match[] {
	const regex = pattern(query, options);
	if (!regex) return [];
	const matches: Match[] = [];
	doc.descendants((node, pos) => {
		if (!node.isTextblock) return true;
		let text = '';
		node.forEach((child) => {
			text += child.isText ? child.text! : OBJECT.repeat(child.nodeSize);
		});
		const start = pos + 1;
		for (const found of text.matchAll(regex)) {
			matches.push({ from: start + found.index, to: start + found.index + found[0].length });
		}
		return false;
	});
	return matches;
}

/** The first match at or after `pos`, wrapping round to the first. */
function nearest(matches: Match[], pos: number): number {
	if (matches.length === 0) return -1;
	const after = matches.findIndex((match) => match.from >= pos);
	return after === -1 ? 0 : after;
}

type Meta =
	| { search: { query: string; options: FindOptions; from: number } }
	| { current: number }
	| { close: true };

function dispatchMeta(view: EditorView, meta: Meta) {
	view.dispatch(view.state.tr.setMeta(findKey, meta).setMeta('addToHistory', false));
}

export function findState(state: EditorState): FindState {
	return findKey.getState(state) ?? EMPTY;
}

/**
 * Look for `query`, starting from the match nearest the cursor, as the
 * writer's place in the text is where they expect to start.
 */
export function search(view: EditorView, query: string, options: FindOptions) {
	dispatchMeta(view, { search: { query, options, from: view.state.selection.from } });
}

/** The next match (`1`) or the previous one (`-1`), wrapping round, scrolled into view. */
export function step(view: EditorView, direction: 1 | -1) {
	const { matches, current } = findState(view.state);
	if (matches.length === 0) return;
	const next = (current + direction + matches.length) % matches.length;
	show(view, next);
}

function show(view: EditorView, index: number) {
	const match = findState(view.state).matches[index];
	if (!match) return;
	// The match is selected, so it scrolls into view and is where the writer
	// lands on closing the bar. Selecting isn't an edit, and stays out of undo.
	const tr = view.state.tr
		.setSelection(TextSelection.create(view.state.doc, match.from, match.to))
		.setMeta(findKey, { current: index } satisfies Meta)
		.setMeta('addToHistory', false)
		.scrollIntoView();
	view.dispatch(tr);
}

/** Stop highlighting, leaving the selection on the last match shown. */
export function closeFind(view: EditorView) {
	dispatchMeta(view, { close: true });
}

/** Puts `text` over `from`–`to`, in the marks the replaced text had. */
function replaceRange(tr: Transaction, from: number, to: number, text: string) {
	return text === '' ? tr.delete(from, to) : tr.insertText(text, from, to);
}

/** Replace the current match, then move on to the one after it. */
export function replaceCurrent(view: EditorView, text: string) {
	if (!view.editable) return;
	const { matches, current } = findState(view.state);
	const match = matches[current];
	if (!match) return;
	view.dispatch(replaceRange(view.state.tr, match.from, match.to, text));
	// The matches were found again after the edit; the next one starts where
	// the replacement ends, so a replacement that itself matches is skipped.
	const after = findState(view.state).matches;
	if (after.length > 0) show(view, nearest(after, match.from + text.length));
}

/** Replace every match, as one step for undo. Returns how many were replaced. */
export function replaceAll(view: EditorView, text: string): number {
	if (!view.editable) return 0;
	const { matches } = findState(view.state);
	if (matches.length === 0) return 0;
	const tr = view.state.tr;
	// From the end, so the positions of the ones before are unchanged.
	for (const { from, to } of [...matches].reverse()) replaceRange(tr, from, to, text);
	// Its own step, even straight after typing, which undo would otherwise join.
	view.dispatch(closeHistory(tr));
	return matches.length;
}

function decorations(state: FindState, doc: ProseMirrorNode): DecorationSet {
	if (state.matches.length === 0) return DecorationSet.empty;
	return DecorationSet.create(
		doc,
		state.matches.map(({ from, to }, index) =>
			Decoration.inline(from, to, {
				class: index === state.current ? 'erti-find-match erti-find-current' : 'erti-find-match'
			})
		)
	);
}

export const FindReplace = Extension.create({
	name: 'findReplace',

	addProseMirrorPlugins() {
		return [
			new Plugin<FindState>({
				key: findKey,

				state: {
					init: () => EMPTY,

					apply(tr, value, _old, state) {
						const meta = tr.getMeta(findKey) as Meta | undefined;
						if (meta && 'close' in meta) return EMPTY;
						if (meta && 'current' in meta) return { ...value, current: meta.current };
						if (meta && 'search' in meta) {
							const { query, options, from } = meta.search;
							const matches = findMatches(state.doc, query, options);
							return { query, options, matches, current: nearest(matches, from) };
						}
						if (!tr.docChanged || value.query === '') return value;

						// Typed while the bar is open, or replaced: found again, keeping
						// the place of the current match.
						const matches = findMatches(state.doc, value.query, value.options);
						const was = value.matches[value.current];
						const current = was ? nearest(matches, tr.mapping.map(was.from)) : nearest(matches, 0);
						return { ...value, matches, current };
					}
				},

				props: {
					decorations(state) {
						return decorations(findState(state), state.doc);
					}
				}
			})
		];
	}
});
