import { Node, mergeAttributes } from '@tiptap/core';
import type { Command, RawCommands } from '@tiptap/core';

import type { EditorState } from '@tiptap/pm/state';

import { NOTES_NODE } from './Notes';

/**
 * The list of works cited, as part of the manuscript.
 *
 * A document node rather than a side panel, for three reasons that all come
 * from what researchers do with it. It has to appear in the exported PDF and
 * LaTeX, at the place the author put it. It has to paginate — a bibliography
 * that runs over a page break is the normal case, not an edge one. And the
 * author decides where it goes: most journals want it last, some want it before
 * appendices, and a thesis may have one per chapter.
 *
 * The entries are held as an attribute rather than rendered live from the
 * store, so they travel with `editor.getJSON()` into the saved file and into
 * every export. `updateAllCitations` refreshes them in the same pass that
 * relabels citations, because both are answers to the same question: what does
 * this document cite, and in what order.
 */

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		bibliography: {
			insertBibliography: () => ReturnType;
		};
	}
}

export interface BibliographyAttributes {
	/** Formatted entries, as HTML, in the order the style prescribes. */
	entries: string[];
	/** How many cited sources are no longer in the library. */
	missing: number;
}

export const BIBLIOGRAPHY_NODE = 'bibliography';

export const Bibliography = Node.create({
	name: BIBLIOGRAPHY_NODE,
	group: 'block',
	atom: true,
	selectable: true,
	draggable: false,

	addAttributes() {
		return {
			entries: {
				default: [] as string[],
				parseHTML: (element) => {
					const raw = element.getAttribute('data-entries');
					if (!raw) return [];
					try {
						const parsed = JSON.parse(raw);
						return Array.isArray(parsed) ? parsed.filter((e) => typeof e === 'string') : [];
					} catch {
						// A hand-edited or truncated file must not stop the document opening.
						return [];
					}
				},
				renderHTML: (attributes) => ({
					'data-entries': JSON.stringify(attributes.entries ?? [])
				})
			},
			missing: {
				default: 0,
				parseHTML: (element) => Number(element.getAttribute('data-missing')) || 0,
				renderHTML: (attributes) => ({ 'data-missing': String(attributes.missing ?? 0) })
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
		container.className = 'bibliography';

		const heading = document.createElement('h2');
		heading.className = 'bibliography-heading';
		heading.textContent = 'References';
		container.appendChild(heading);

		const entries: string[] = node.attrs.entries ?? [];

		if (entries.length === 0) {
			const empty = document.createElement('p');
			empty.className = 'bibliography-empty';
			// Said plainly, because an empty references list in a manuscript that
			// should have one is alarming if it is not explained.
			empty.textContent = 'Nothing is cited yet. Cited works will be listed here.';
			container.appendChild(empty);
		}

		for (const entry of entries) {
			const item = document.createElement('div');
			item.className = 'bibliography-entry';
			// citeproc emits the formatted entry as HTML: italics for titles,
			// spans carrying the style's own hanging-indent markup.
			item.innerHTML = entry;
			container.appendChild(item);
		}

		const missing: number = node.attrs.missing ?? 0;
		if (missing > 0) {
			// A citation whose source was removed cannot appear in the list, so
			// without this the manuscript would quietly cite works that the
			// references section does not mention.
			const warning = document.createElement('p');
			warning.className = 'bibliography-missing';
			warning.textContent =
				missing === 1
					? '1 cited source is no longer in your library and is not listed above.'
					: `${missing} cited sources are no longer in your library and are not listed above.`;
			container.appendChild(warning);
		}

		return container;
	},

	renderText({ node }) {
		const entries: string[] = node.attrs.entries ?? [];
		return ['References', ...entries.map(stripHtml)].join('\n');
	},

	addCommands() {
		return {
			/**
			 * Add a references section, or move focus to the one already there.
			 *
			 * A second bibliography would be filled with the same entries by the
			 * render pass and read as a duplicated list.
			 */
			insertBibliography:
				(): Command =>
				({ chain, state }) => {
					let existing: number | null = null;
					state.doc.descendants((node, pos) => {
						if (node.type.name === BIBLIOGRAPHY_NODE && existing === null) existing = pos;
						return existing === null;
					});

					if (existing !== null) {
						return chain().focus().setNodeSelection(existing).run();
					}

					// A note style needs somewhere for its notes to go, and the two
					// belong together at the end of the manuscript. Guarded on the
					// schema rather than assumed: Bibliography must stay usable on its
					// own, and referring to a node type that is not registered fails
					// the whole insert with nothing to show for it.
					const content: Array<Record<string, unknown>> = [];
					if (state.schema.nodes[NOTES_NODE] && !hasNode(state, NOTES_NODE)) {
						content.push({ type: NOTES_NODE, attrs: { notes: [] } });
					}
					content.push({ type: BIBLIOGRAPHY_NODE, attrs: { entries: [], missing: 0 } });

					return (
						chain()
							.focus()
							.insertContentAt(state.doc.content.size, content)
							// Empty until the render pass fills it, which is the same pass
							// that relabels citations.
							.updateAllCitation()
							.run()
					);
				}
		} as Partial<RawCommands>;
	}
});

function findNode(state: EditorState, name: string): number | null {
	let found: number | null = null;
	state.doc.descendants((node, pos) => {
		if (node.type.name === name && found === null) found = pos;
		return found === null;
	});
	return found;
}

const hasNode = (state: EditorState, name: string) => findNode(state, name) !== null;

function stripHtml(html: string): string {
	return html
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}
