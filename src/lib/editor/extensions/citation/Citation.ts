import { mount } from 'svelte';
import tippy from 'tippy.js';

import type { Command, CommandProps, RawCommands } from '@tiptap/core';
import { Node } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';

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
						const citationIds = JSON.parse(id);
						const citationText = citationStore.getInlineCitation(citationIds);

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
		span.innerHTML = node.attrs.label;

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
			updateAllCitation:
				(): Command =>
				({ tr }) => {
					let updated = false;
					tr.doc.descendants((node, pos) => {
						if (node.type.name === 'citation') {
							const citationId = node.attrs.id ? JSON.parse(node.attrs.id) : null;

							if (citationId) {
								const newCitationText = citationStore.getInlineCitation(citationId);
								tr.setNodeMarkup(pos, undefined, {
									...node.attrs,
									label: newCitationText
								});
								updated = true;
							}
						}
						return true;
					});

					return updated;
				}
		} as Partial<RawCommands>;
	},
	addProseMirrorPlugins() {
		return [
			Suggestion({
				char: '@',
				pluginKey: CitationPluginKey,
				...suggestion(this.editor)
			})
		];
	}
});
