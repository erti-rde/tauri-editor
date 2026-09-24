import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/**
 * A quiet mark in the margin, beside a paragraph you have written something
 * about and not used.
 *
 * This is the one part of the reading feature that speaks without being asked,
 * so it is built to be ignorable: a small neutral dot, no colour, no motion, no
 * popup until it is clicked, and one per paragraph at most. Quiet enough not to
 * need turning off is the design target — and it can be turned off.
 *
 * A decoration rather than anything in the document. Nothing here is content: it
 * must never reach `getJSON`, never travel to a co-author, and never appear in
 * an export.
 */

export const nudgeKey = new PluginKey<NudgeState>('noteNudge');

export interface NudgeState {
	/** Where the paragraph starts, or null for no mark. */
	pos: number | null;
	/** How many unused notes bear on it. */
	count: number;
}

const EMPTY: NudgeState = { pos: null, count: 0 };

/**
 * Put the mark beside a paragraph, or take it away.
 *
 * Kept out of the undo history: this is not an edit, and undoing a keystroke
 * should not first undo a dot appearing.
 */
export function showNudge(view: EditorView, state: NudgeState) {
	const current = nudgeKey.getState(view.state) ?? EMPTY;
	if (current.pos === state.pos && current.count === state.count) return;

	view.dispatch(view.state.tr.setMeta(nudgeKey, state).setMeta('addToHistory', false));
}

export interface NoteNudgeOptions {
	/** Opening the notes panel, when the mark is clicked. */
	onOpen: (() => void) | null;
}

export const NoteNudge = Extension.create<NoteNudgeOptions>({
	name: 'noteNudge',

	addOptions() {
		return { onOpen: null };
	},

	addProseMirrorPlugins() {
		const options = this.options;

		return [
			new Plugin<NudgeState>({
				key: nudgeKey,

				state: {
					init: () => EMPTY,

					apply(tr, value) {
						const meta = tr.getMeta(nudgeKey) as NudgeState | undefined;
						if (meta) return meta;

						if (value.pos === null) return value;

						// Mapped through edits so the mark stays with its paragraph
						// while text above it is typed, rather than sliding up the page.
						const mapped = tr.mapping.mapResult(value.pos);
						return mapped.deleted ? EMPTY : { ...value, pos: mapped.pos };
					}
				},

				props: {
					decorations(state) {
						const nudge = nudgeKey.getState(state) ?? EMPTY;
						if (nudge.pos === null || nudge.count === 0) return null;

						return DecorationSet.create(state.doc, [
							Decoration.widget(nudge.pos, () => marker(nudge.count, options.onOpen), {
								// Drawn before the paragraph's content and ignored by the
								// selection, so it cannot be typed over or deleted.
								side: -1,
								ignoreSelection: true
							})
						]);
					}
				}
			})
		];
	}
});

function marker(count: number, onOpen: (() => void) | null): HTMLElement {
	const button = document.createElement('button');

	button.type = 'button';
	button.className = 'erti-nudge';
	button.setAttribute(
		'aria-label',
		count === 1
			? 'You have a note that bears on this paragraph'
			: `You have ${count} notes that bear on this paragraph`
	);
	button.title = button.getAttribute('aria-label') ?? '';
	button.addEventListener('click', (event) => {
		event.preventDefault();
		onOpen?.();
	});

	return button;
}
