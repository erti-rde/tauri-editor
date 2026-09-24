import type { MarkStyle } from '$lib/stores/db';

/**
 * What the reader has in hand.
 *
 * One tool at a time, as in Zotero's reader. This replaced a pair of
 * independent flags — a mark style and a separate "dragging a box" boolean —
 * which could both be on at once and left the code asking `style && !snapping`
 * in four places to work out what a drag meant. A single value cannot be in a
 * contradictory state, and it is also what the toolbar is: four buttons of
 * which at most one is pressed.
 *
 * Null is a real answer rather than a missing one. With no tool in hand,
 * selecting text raises the popup and the choice is made per passage — which is
 * what someone who only wanted to copy a sentence needs, and what makes leaving
 * a tool latched a deliberate act.
 */
export type ReaderTool = 'highlight' | 'underline' | 'note' | 'area' | null;

/** How a tool draws, or null for the ones that do not mark words. */
export function styleOf(tool: ReaderTool): MarkStyle | null {
	if (tool === 'highlight') return 'fill';
	if (tool === 'underline') return 'underline';
	return null;
}

/** Whether the pointer should draw a box over the page rather than select words. */
export function dragsABox(tool: ReaderTool): boolean {
	return tool === 'area';
}

/** Whether a click on the page should leave a note where it lands. */
export function placesANote(tool: ReaderTool): boolean {
	return tool === 'note';
}

/**
 * How big a placed note is, in PDF points.
 *
 * Zotero uses 22pt for the same thing. The number matters because it is stored:
 * a note's square is its anchor, so it has to be a size that reads as a marker
 * at any zoom rather than one that grows into a block of colour.
 */
export const NOTE_SIZE = 22;
