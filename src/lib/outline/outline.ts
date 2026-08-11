import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * The document's headings, as something to navigate by.
 *
 * A thesis is the length where scrolling stops working and the only way to
 * reach section four is to remember roughly where it was. The outline is the
 * map — and because it is built from the headings themselves, a document
 * without them shows nothing, which is the honest answer rather than an empty
 * box pretending to be broken.
 */

export interface Heading {
	/** Position in the document, which is what navigation needs. */
	pos: number;
	/** The heading level as written: 1, 2 or 3. */
	level: number;
	text: string;
	/**
	 * How far to indent it, counted in levels *actually used* rather than in
	 * absolute heading levels.
	 *
	 * A paper whose top level is `##` — which is most of them, since the title
	 * is usually not a heading at all — would otherwise begin indented, with a
	 * column of empty space down the left and nothing at the root.
	 */
	depth: number;
}

/** Read the headings out of a document, in the order they appear. */
export function readOutline(doc: ProseMirrorNode): Heading[] {
	const found: { pos: number; level: number; text: string }[] = [];

	doc.descendants((node, pos) => {
		if (node.type.name !== 'heading') return true;

		found.push({
			pos,
			level: Number(node.attrs.level) || 1,
			// `textContent` rather than the node's children: a heading can hold
			// marks, and a citation inside one would otherwise contribute nothing.
			text: node.textContent.trim()
		});

		// Nothing inside a heading is itself a heading.
		return false;
	});

	return withDepth(found);
}

/**
 * Turn absolute heading levels into indentation.
 *
 * The levels present are ranked, so `##`/`###` indents the same as `#`/`##`.
 * A level that appears without its parent — `###` directly under `#` — moves up
 * rather than leaving a gap, because the gap reads as a missing heading.
 */
function withDepth(found: { pos: number; level: number; text: string }[]): Heading[] {
	const levels = [...new Set(found.map((h) => h.level))].sort((a, b) => a - b);

	return found.map((heading) => ({
		...heading,
		depth: levels.indexOf(heading.level)
	}));
}

/**
 * The heading a given position falls under.
 *
 * Used to mark where the reader is. Returns the last heading at or before the
 * position, which is the one whose section they are in — not the nearest, which
 * would jump ahead as soon as the next heading came within a few lines.
 */
export function headingAt(headings: Heading[], pos: number): Heading | null {
	let current: Heading | null = null;

	for (const heading of headings) {
		if (heading.pos > pos) break;
		current = heading;
	}

	return current;
}

/**
 * Whether two outlines differ.
 *
 * The outline is recomputed on every document change and almost always comes
 * back identical — typing inside a paragraph cannot alter it. Comparing before
 * publishing keeps the panel from re-rendering on every keystroke.
 */
export function sameOutline(a: Heading[], b: Heading[]): boolean {
	if (a.length !== b.length) return false;

	return a.every((heading, i) => {
		const other = b[i];
		return (
			heading.pos === other.pos && heading.level === other.level && heading.text === other.text
		);
	});
}
