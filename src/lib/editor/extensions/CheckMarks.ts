import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/**
 * Where the attribution check's findings are, and the one being looked at
 * (M4-5 AC-4, docs/ux.md UX-7).
 *
 * Every finding's sentence is tracked, so a range still points at its
 * sentence after text above it is typed, and a fix lands where the sentence
 * is now. Only the selected one is drawn: a quiet underline on that sentence
 * alone, never a squiggle across the page.
 *
 * Decorations, like the note nudge: nothing here is content, so it never
 * reaches `getJSON`, an export or a co-author.
 */

export const checkMarksKey = new PluginKey<CheckMarksState>('checkMarks');

export interface MarkedRange {
	id: string;
	from: number;
	to: number;
}

interface CheckMarksState {
	/** Every finding's sentence, drawn as nothing; their positions map through edits. */
	ranges: DecorationSet;
	selected: string | null;
}

type Meta = { ranges: MarkedRange[] } | { selected: string | null };

const EMPTY: CheckMarksState = { ranges: DecorationSet.empty, selected: null };

function dispatch(view: EditorView, meta: Meta) {
	// Not an edit: kept out of the undo history.
	view.dispatch(view.state.tr.setMeta(checkMarksKey, meta).setMeta('addToHistory', false));
}

/** Track these ranges, replacing any tracked before. */
export function markRanges(view: EditorView, ranges: MarkedRange[]) {
	dispatch(view, { ranges });
}

/** Underline one range, or none. */
export function selectRange(view: EditorView, id: string | null) {
	dispatch(view, { selected: id });
}

/** Where a tracked range is now, or null once its sentence has gone. */
export function rangeOf(state: EditorState, id: string): { from: number; to: number } | null {
	const marks = checkMarksKey.getState(state) ?? EMPTY;
	const found = marks.ranges.find(undefined, undefined, (spec) => spec.id === id)[0];
	return found ? { from: found.from, to: found.to } : null;
}

export const CheckMarks = Extension.create({
	name: 'checkMarks',

	addProseMirrorPlugins() {
		return [
			new Plugin<CheckMarksState>({
				key: checkMarksKey,

				state: {
					init: () => EMPTY,

					apply(tr, value, _old, state) {
						const meta = tr.getMeta(checkMarksKey) as Meta | undefined;
						const mapped = tr.docChanged ? value.ranges.map(tr.mapping, tr.doc) : value.ranges;
						if (!meta) return { ...value, ranges: mapped };
						if ('selected' in meta) return { ranges: mapped, selected: meta.selected };

						const size = state.doc.content.size;
						const decorations = meta.ranges
							.filter(({ from, to }) => from < to && from >= 0 && to <= size)
							.map(({ id, from, to }) => Decoration.inline(from, to, {}, { id }));
						return { ranges: DecorationSet.create(state.doc, decorations), selected: null };
					}
				},

				props: {
					decorations(state) {
						const marks = checkMarksKey.getState(state) ?? EMPTY;
						if (marks.selected === null) return null;
						const range = rangeOf(state, marks.selected);
						if (!range) return null;
						return DecorationSet.create(state.doc, [
							Decoration.inline(range.from, range.to, { class: 'erti-check-sentence' })
						]);
					}
				}
			})
		];
	}
});
