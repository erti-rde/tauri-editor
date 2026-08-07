import { Node, mergeAttributes } from '@tiptap/core';

import { sanitizeCitationHtml, setCitationHtml } from '$lib/citations/sanitize';

/**
 * The notes a note style produces, collected at the end of the manuscript.
 *
 * Chicago notes-bibliography and Turabian — the humanities standard — put the
 * reference in a note and leave only a marker in the sentence. citeproc returns
 * the note's text; until now the editor dropped that text inline, so a Chicago
 * document read "…as argued Alice Smith, "Coastal Erosion under Rising Sea
 * Levels," Journal of Coastal Research 36, no. 2 (2020): 101-18. in the
 * literature", which is precisely what those styles exist to avoid.
 *
 * **These are endnotes, not footnotes.** A true footnote sits at the foot of
 * the page it is referenced from, which needs pagination the editor does not
 * have: browsers have no usable footnote support in print, and getting there
 * means a paged-media layer. Endnotes are correct academic practice in their
 * own right, accepted by many journals, and they carry the same numbering and
 * short forms. Naming them honestly here rather than calling them footnotes and
 * disappointing someone at submission time.
 */

export interface NoteEntry {
	index: number;
	text: string;
}

export const NOTES_NODE = 'notes';

export const Notes = Node.create({
	name: NOTES_NODE,
	group: 'block',
	atom: true,
	selectable: true,
	draggable: false,

	addAttributes() {
		return {
			notes: {
				default: [] as NoteEntry[],
				parseHTML: (element) => {
					const raw = element.getAttribute('data-notes');
					if (!raw) return [];
					try {
						const parsed = JSON.parse(raw);
						return Array.isArray(parsed)
							? parsed.filter(
									(n) => n && typeof n.text === 'string' && Number.isFinite(Number(n.index))
								)
							: [];
					} catch {
						// A hand-edited or truncated file must not stop the document opening.
						return [];
					}
				},
				// Sanitized on the way out as well as at render, so hostile markup
				// carried in by a file cannot survive a save-and-reopen cycle.
				renderHTML: (attributes) => ({
					'data-notes': JSON.stringify(
						((attributes.notes ?? []) as NoteEntry[]).map((n) => ({
							index: n.index,
							text: sanitizeCitationHtml(n.text)
						}))
					)
				})
			}
		};
	},

	parseHTML() {
		return [{ tag: `div[data-type="${this.name}"]` }];
	},

	renderHTML({ node, HTMLAttributes }) {
		const container = document.createElement('div');
		for (const [key, value] of Object.entries(
			mergeAttributes(HTMLAttributes, { 'data-type': this.name })
		)) {
			if (value != null) container.setAttribute(key, String(value));
		}
		container.className = 'notes';

		const heading = document.createElement('h2');
		heading.className = 'notes-heading';
		heading.textContent = 'Notes';
		container.appendChild(heading);

		const notes: NoteEntry[] = node.attrs.notes ?? [];

		if (notes.length === 0) {
			const empty = document.createElement('p');
			empty.className = 'notes-empty';
			empty.textContent =
				'Notes appear here when the citation style uses them, such as Chicago notes-bibliography.';
			container.appendChild(empty);
			return container;
		}

		const list = document.createElement('ol');
		list.className = 'notes-list';
		for (const note of notes) {
			const item = document.createElement('li');
			item.className = 'notes-entry';
			item.value = note.index;
			item.id = `note-${note.index}`;
			// citeproc emits the note as HTML — italics for titles, quotation marks
			// the locale chose. Sanitized because this text comes back out of the
			// manuscript file, and manuscripts arrive from co-authors.
			setCitationHtml(item, note.text);
			list.appendChild(item);
		}
		container.appendChild(list);

		return container;
	},

	renderText({ node }) {
		const notes: NoteEntry[] = node.attrs.notes ?? [];
		return [
			'Notes',
			...notes.map(
				(n) =>
					`${n.index}. ${n.text
						.replace(/<[^>]+>/g, '')
						.replace(/\s+/g, ' ')
						.trim()}`
			)
		].join('\n');
	}
});
