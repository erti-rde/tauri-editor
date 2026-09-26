import { mount } from 'svelte';
import tippy from 'tippy.js';

import type { Command, CommandProps, RawCommands } from '@tiptap/core';
import { Node } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import type { Node as ProsemirrorNode } from '@tiptap/pm/model';
import Suggestion from '@tiptap/suggestion';

import { parseCitationIds, type CitationSite, type RenderedNote } from '$lib/citations/document';
import { setCitationHtml } from '$lib/citations/sanitize';
import { BIBLIOGRAPHY_NODE } from './Bibliography';
import { NOTES_NODE } from './Notes';
import { citationStore } from '$lib/stores/citationStore';

import SvelteRenderer from '../../core/SvelteRenderer';
import CitationSuggestion from './CitationSuggestion.svelte';
import { suggestion } from './Suggestion.svelte';

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		citation: {
			insertCitation: (props: CitationNodeAttrs) => ReturnType;
			updateAllCitation: () => ReturnType;
		};
	}
}
export interface CitationNodeAttrs {
	id: string | null;
	label: string | null;
}

export const CitationPluginKey = new PluginKey('citation');

/** The cited ids in document order — what the rendering actually depends on. */
function citationSignature(doc: ProsemirrorNode): string {
	const parts: string[] = [];
	doc.descendants((node) => {
		if (node.type.name === 'citation') parts.push(parseCitationIds(node.attrs.id).join(','));
		// Adding or removing the references section changes what has to be
		// rendered, though it cites nothing itself.
		if (node.type.name === BIBLIOGRAPHY_NODE) parts.push('#bibliography');
		if (node.type.name === NOTES_NODE) parts.push('#notes');
		return true;
	});
	return parts.join('|');
}

/**
 * Write the current works-cited list into the document's references section.
 *
 * The entries live on the node so they travel with `getJSON()` into the saved
 * file and into every export, rather than existing only on screen.
 */
function refreshBibliography(tr: Transaction, entries: string[], missing: number): boolean {
	let updated = false;

	tr.doc.descendants((node, pos) => {
		if (node.type.name !== BIBLIOGRAPHY_NODE) return true;

		const same =
			node.attrs.missing === missing &&
			Array.isArray(node.attrs.entries) &&
			node.attrs.entries.length === entries.length &&
			node.attrs.entries.every((e: string, i: number) => e === entries[i]);

		if (!same) {
			tr.setNodeMarkup(pos, undefined, { ...node.attrs, entries, missing });
			updated = true;
		}
		return true;
	});

	return updated;
}

/** Write the current notes into the document's notes section, if it has one. */
function refreshNotes(tr: Transaction, notes: RenderedNote[]): boolean {
	let updated = false;

	tr.doc.descendants((node, pos) => {
		if (node.type.name !== NOTES_NODE) return true;

		const current: RenderedNote[] = node.attrs.notes ?? [];
		const same =
			current.length === notes.length &&
			current.every((n, i) => n.index === notes[i].index && n.text === notes[i].text);

		if (!same) {
			tr.setNodeMarkup(pos, undefined, { ...node.attrs, notes });
			updated = true;
		}
		return true;
	});

	return updated;
}

/**
 * Re-render every citation in the document against the document.
 *
 * Formatting each citation on its own cannot be correct: two different Smith
 * 2020 papers both render "(Smith, 2020)", repeated notes are never shortened,
 * and note numbers are all 0. Those are properties of the manuscript as a
 * whole, so the whole ordered list goes to the processor at once.
 */
function updateAllCitations(tr: Transaction): boolean {
	const sites: CitationSite[] = [];
	tr.doc.descendants((node, pos) => {
		if (node.type.name === 'citation') {
			sites.push({ pos, itemIds: parseCitationIds(node.attrs.id) });
		}
		return true;
	});

	// An empty document is still rendered, because the store has to be told: the
	// bibliography and the missing-source markers left by the citations that were
	// just deleted have to go with them.
	const rendered = citationStore.renderDocument(sites);
	if (!rendered) return false;

	// The references section is refreshed even when nothing is cited any more —
	// that is exactly when it has to empty out.
	let updated = refreshBibliography(tr, rendered.bibliography, rendered.missingIds.length);
	updated = refreshNotes(tr, rendered.notes) || updated;

	if (sites.length === 0) return updated;
	const idsAt = new Map(sites.map((site) => [site.pos, site.itemIds]));
	for (const site of rendered.sites) {
		const node = tr.doc.nodeAt(site.pos);
		if (!node) continue;
		const cited = idsAt.get(site.pos) ?? [];
		const away = cited.some((id) => citationStore.isAway(id));
		if (
			node.attrs.label === site.label &&
			node.attrs.noteIndex === site.noteIndex &&
			node.attrs.away === away
		)
			continue;

		// A citation is an inline atom, so rewriting its attributes does not move
		// anything after it and the collected positions stay valid.
		tr.setNodeMarkup(site.pos, undefined, {
			...node.attrs,
			label: site.label,
			noteIndex: site.noteIndex,
			away
		});
		updated = true;
	}

	return updated;
}

export const Citation = Node.create({
	name: 'citation',
	priority: 101,
	group: 'inline',
	inline: true,
	selectable: true,
	atom: true,

	addStorage() {
		return {
			component: null,
			popup: null,
			active: false,
			handleKeyDown: null,
			renderer: null,
			target: null
		};
	},
	/**
	 * Render the citations a manuscript was opened with.
	 *
	 * Loading a document is not a transaction, so the plugin below never sees it
	 * and the labels stay as they were last saved. That goes stale the moment
	 * anything else moves: a source removed from the library, metadata corrected,
	 * or a different CSL style chosen since the file was written. Until the user
	 * happened to make an edit, the manuscript showed citations that no longer
	 * matched its own bibliography.
	 */
	onCreate() {
		this.editor.commands.updateAllCitation();
	},

	onSelectionUpdate() {
		const isInCitation = this.editor.isActive('citation');

		// Case 1: We're entering a citation node
		if (isInCitation && !this.storage.active) {
			const attrs = this.editor.getAttributes('citation');

			this.storage.target = document.createElement('div');
			const props = {
				items: Object.values(citationStore.getAllSourcesAsJson()),
				initialSelection: JSON.parse(attrs.id),
				cl: (id: string | null) => {
					console.log('Command executed with id:', id);
					const { state: editorState } = this.editor;
					const { selection } = editorState;
					const { from, to } = selection;
					if (!id) {
						// if no id is provided, delete the citation node
						this.editor
							.chain()
							.focus()
							.deleteRange({
								from,
								to
							})
							.run();
					} else {
						// Handle updating the citation with new IDs

						// Get the formatted citation text
						// Provisional: the document render below replaces it with the
						// citation as it should read given everything else cited.
						const citationText = citationStore.previewCitation(parseCitationIds(id));

						// Update the citation
						this.editor
							.chain()
							.focus()
							.setNodeSelection(from)
							.insertContentAt(
								{ from, to },
								{
									type: 'citation',
									attrs: {
										id: id,
										label: citationText
									}
								}
							)
							.run();
					}

					// Close the popup after selection
					if (this.storage.popup && this.storage.popup[0]) {
						this.storage.popup[0].destroy();
						this.storage.popup = null;
					}

					console.log({ state: this.storage });
				}
			};
			// Create the component
			this.storage.component = mount(CitationSuggestion, {
				target: this.storage.target,
				props
			});

			this.storage.renderer = new SvelteRenderer(this.storage.component, {
				element: this.storage.target,
				props
			});

			// Get the current citation node DOM element
			// Get editor state and selection information
			const { state: editorState } = this.editor;
			const { selection } = editorState;

			// Find the citation node at the selection
			let citationNode = null;
			let nodePos = -1;

			// More reliable way to find citation node
			const $from = selection.$from;

			// Search for citation node around the cursor position
			for (let i = $from.depth; i >= 0; i--) {
				const node = $from.node(i);
				if (node.type.name === 'citation') {
					citationNode = node;
					nodePos = $from.start(i);
					break;
				}
			}

			// If we didn't find it going up, check if we're at a leaf node
			if (!citationNode) {
				// Check if cursor is directly in a citation node
				const nodeAtPos = editorState.doc.nodeAt(selection.from);
				if (nodeAtPos && nodeAtPos.type.name === 'citation') {
					citationNode = nodeAtPos;
					nodePos = selection.from;
				}
			}

			// If we still couldn't find it, search in a small range around the cursor
			if (!citationNode) {
				const range = 5; // Search a few characters before/after cursor
				const fromPos = Math.max(0, selection.from - range);
				const toPos = Math.min(editorState.doc.content.size, selection.to + range);

				editorState.doc.nodesBetween(fromPos, toPos, (node, pos) => {
					if (node.type.name === 'citation') {
						citationNode = node;
						nodePos = pos;
						return false; // Stop iteration
					}
					return true;
				});
			}
			if (!citationNode || nodePos < 0) return;

			// Get the DOM node using resolvedPos for more accuracy
			const domNode = this.editor.view.domAtPos(nodePos)?.node || null;
			const citationElement =
				domNode instanceof Text
					? domNode.parentElement
					: domNode instanceof HTMLElement
						? domNode
						: null;

			// Find the citation element if we got a parent or child
			const findCitationElement = (el: HTMLElement | null): HTMLElement | null => {
				if (!el) return null;
				if (el.dataset.type === 'citation') return el;
				// Look up (parents)
				let parent = el.parentElement;
				while (parent) {
					if (parent.dataset.type === 'citation') return parent;
					parent = parent.parentElement;
				}
				// Look down (children)
				const citationChild = el.querySelector('[data-type="citation"]');
				return (citationChild as HTMLElement) || null;
			};

			const finalElement = findCitationElement(citationElement);

			if (finalElement) {
				const rect = finalElement.getBoundingClientRect();

				// Create the popup with tippy
				this.storage.popup = tippy([document.body], {
					getReferenceClientRect: () => rect,
					appendTo: () => document.body,
					content: this.storage.renderer.dom,
					showOnCreate: true,
					interactive: true,
					trigger: 'manual',
					placement: 'bottom-start'
				});
				// Setup keyboard handler for the editor view
				this.storage.handleKeyDown = this.storage.component.onKeyDown;

				this.editor.view.dom.addEventListener(
					'keydown',
					(this.storage.handleKeyDown = (event: KeyboardEvent) => {
						if (!this.storage.component) return;

						// Prevent default action for Enter and Escape keys first
						if (event.key === 'Enter' || event.key === 'Escape') {
							event.preventDefault();
							event.stopPropagation();

							// For Escape key, hide the popup directly
							if (event.key === 'Escape' && this.storage.popup && this.storage.popup[0]) {
								this.storage.popup[0].hide();
								return;
							}
						}

						// Let the component handle the keydown event
						const handled =
							this.storage.component.onKeyDown && this.storage.component.onKeyDown({ event });
						// console.log({ handled, key: event.key });

						// If component handled it, make sure to prevent default behavior
						if (handled) {
							event.preventDefault();
							event.stopPropagation();
						}
					}),
					{ capture: true } // Use capture phase to intercept events before they reach the editor
				);
				this.storage.active = true;
			}
		}
		// Case 2: We're leaving a citation node
		else if (!isInCitation && this.storage.active) {
			console.log('Case 2: We are leaving a citation node');

			// Clean up the popup and component
			if (this.storage.popup && this.storage.popup[0]) {
				this.storage.popup[0].destroy();
				this.storage.popup = null;
			}

			if (this.storage.component) {
				this.storage.renderer.destroy();
				this.storage.component = null;
				this.storage.target.remove();
				this.storage.target = null;
			}
			if (this.storage.handleKeyDown) {
				try {
					this.editor.view.dom.removeEventListener('keydown', this.storage.handleKeyDown, {
						capture: true
					});
				} catch (e) {
					console.error('Error removing event listener:', e);
				}
				this.storage.handleKeyDown = null;
			}

			this.storage.active = false;
		}
		// Case 3: We're updating within a citation node
		else if (isInCitation && this.storage.active) {
			console.log('Case 3: We re updating within a citation node');
			// Update the popup position if needed
			const { state: editorState } = this.editor;
			const { selection } = editorState;
			const $pos = selection.$from;
			let pos = $pos.pos;
			let node = null;

			// Find the citation node at current position
			editorState.doc.nodesBetween($pos.pos, $pos.pos, (n, p) => {
				if (n.type.name === 'citation') {
					node = n;
					pos = p;
					return false; // Stop iteration
				}
			});

			if (!node) return;

			// Get the DOM node using the correct position
			const domNode = this.editor.view.nodeDOM(pos);

			if (domNode instanceof HTMLElement && this.storage.popup && this.storage.popup[0]) {
				const rect = domNode.getBoundingClientRect();
				this.storage.popup[0].setProps({
					getReferenceClientRect: () => rect
				});
			}
		}
	},

	addAttributes() {
		return {
			id: {
				default: null,
				parseHTML: (element) => element.getAttribute('data-id'),
				renderHTML: (attributes) => (attributes.id ? { 'data-id': attributes.id } : {})
			},
			label: {
				default: null,
				parseHTML: (element) => element.getAttribute('data-label'),
				renderHTML: (attributes) => (attributes.label ? { 'data-label': attributes.label } : {})
			},
			/**
			 * The note number, when the style puts citations in notes.
			 *
			 * Zero for in-text styles. Non-zero means `label` holds the marker and
			 * the reference itself lives in the notes section.
			 */
			noteIndex: {
				default: 0,
				parseHTML: (element) => Number(element.getAttribute('data-note-index')) || 0,
				renderHTML: (attributes) =>
					attributes.noteIndex ? { 'data-note-index': String(attributes.noteIndex) } : {}
			},
			/**
			 * Rendered from the snapshot the manuscript carries, because this
			 * library doesn't have the source (M1a-8, UX-12). Set with the label on
			 * every render, since adding the source changes it.
			 */
			away: {
				default: false,
				parseHTML: (element) => element.hasAttribute('data-away'),
				renderHTML: (attributes) => (attributes.away ? { 'data-away': '' } : {})
			}
		};
	},

	parseHTML() {
		return [
			{
				tag: `span[data-type="${this.name}"]`
			}
		];
	},

	renderHTML({ node }) {
		const span = document.createElement('span');
		span.dataset.type = this.name;
		span.dataset.id = node.attrs.id;
		span.dataset.label = node.attrs.label;
		if (node.attrs.away) span.dataset.away = '';

		// In a note style the sentence carries a marker and the reference itself is
		// in the notes section. Rendering the note text here instead would put a
		// full bibliographic reference in the middle of the author's prose.
		if (node.attrs.noteIndex) {
			span.dataset.noteIndex = String(node.attrs.noteIndex);
			const marker = document.createElement('sup');
			marker.className = 'citation-note-marker';
			marker.textContent = String(node.attrs.noteIndex);
			span.appendChild(marker);
			return span;
		}

		setCitationHtml(span, node.attrs.label);
		return span;
	},

	renderText({ node }) {
		return node.attrs.label || node.attrs.id || '';
	},

	addKeyboardShortcuts() {
		return {
			Backspace: () =>
				this.editor.commands.command(({ tr, state }) => {
					let isCitation = false;
					const { selection } = state;
					const { empty, anchor } = selection;

					if (!empty) {
						return false;
					}

					state.doc.nodesBetween(anchor - 1, anchor, (node, pos) => {
						if (node.type.name === this.name) {
							isCitation = true;
							tr.insertText('@', pos, pos + node.nodeSize);
							return false;
						}
					});

					return isCitation;
				})
		};
	},
	addCommands() {
		return {
			insertCitation:
				(attrs: CitationNodeAttrs): Command =>
				({ chain, state }: CommandProps) => {
					const pos = state.selection.to;
					const { doc } = state;

					// Check if we need to add a space before the citation
					const needsSpace = pos > 0 && doc.textBetween(pos - 1, pos) !== ' ';

					// Create the citation text
					const citationText = attrs.label as string;

					return chain()
						.focus()
						.insertContentAt(pos, [
							...(needsSpace ? [{ type: 'text', text: ' ' }] : []),
							{ type: 'citation', attrs: { label: citationText, id: attrs.id } },
							{ type: 'text', text: ' ' }
						])
						.run();
				},
			/**
			 * Re-render every citation on demand.
			 *
			 * The document plugin covers edits. This covers the other trigger: the
			 * user changing CSL style, where the manuscript is untouched but every
			 * citation and the bibliography must be rebuilt.
			 */
			updateAllCitation:
				(): Command =>
				({ tr }) => {
					// Same reason as the plugin: re-labelling is a consequence of an
					// edit, not an edit. onCreate runs this as a manuscript loads, so
					// without this the document opens already "changed" — the first
					// undo would strip the labels, and autosave would write a file the
					// user never touched.
					tr.setMeta('addToHistory', false);
					return updateAllCitations(tr);
				}
		} as Partial<RawCommands>;
	},
	addProseMirrorPlugins() {
		return [
			Suggestion({
				char: '@',
				pluginKey: CitationPluginKey,
				...suggestion(this.editor)
			}),

			/**
			 * Keep every citation correct as the document changes.
			 *
			 * Adding, removing or moving a citation changes how the *others* should
			 * read: a second Smith 2020 makes both need a disambiguating letter, a
			 * deleted one takes those letters away again, and in a note style every
			 * note after the edit is renumbered.
			 *
			 * This reacts to the document rather than hanging off each command, so
			 * undo, redo, paste, cut, backspace and drag all go through it — the
			 * paths that would otherwise be missed one at a time.
			 */
			new Plugin({
				key: new PluginKey('citationRender'),
				appendTransaction(transactions, oldState, newState) {
					if (!transactions.some((tr) => tr.docChanged)) return null;

					// Only the cited ids and their order matter. Labels are excluded on
					// purpose: this plugin's own rewrite changes them, and including
					// them would make it retrigger on its own output forever.
					if (citationSignature(oldState.doc) === citationSignature(newState.doc)) return null;

					const tr = newState.tr;
					const applied = updateAllCitations(tr);

					// Re-labelling is a consequence of the user's edit, not an edit of
					// its own; folding it into history would make undo a two-step.
					return applied ? tr.setMeta('addToHistory', false) : null;
				}
			})
		];
	}
});
