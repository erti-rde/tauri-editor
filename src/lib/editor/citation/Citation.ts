import tippy from 'tippy.js';
import CitationSuggestion from './CitationSuggestion.svelte';
import { citationStore } from '$lib/stores/citationStore';

import { Node } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';

import type { Instance, Props } from 'tippy.js';
import type { Command, CommandProps, RawCommands } from '@tiptap/core';

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		citation: {
			insertCitation: (props: CitationNodeAttrs) => ReturnType;
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
							tr.insertText(
								this.options.deleteTriggerWithBackspace ? '' : '@',
								pos,
								pos + node.nodeSize
							);
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
				}
		} as Partial<RawCommands>;
	},
	addProseMirrorPlugins() {
		return [
			Suggestion({
				editor: this.editor,
				char: '@',
				pluginKey: CitationPluginKey,
				command: ({ editor, range, props }) => {
					// Get the formatted citation text from our store
					const citationIds = JSON.parse(props.id as string) as string[];
					const citationText = citationStore.getInlineCitation(citationIds);

					// Check if we need to extend range for spaces
					const nodeAfter = editor.view.state.selection.$to.nodeAfter;
					const overrideSpace = nodeAfter?.text?.startsWith(' ');

					if (overrideSpace) {
						range.to += 1;
					}

					// Insert the citation
					editor
						.chain()
						.focus()
						.insertContentAt(range, [
							{
								type: 'citation',
								attrs: {
									id: props.id,
									label: citationText
								}
							},
							{
								type: 'text',
								text: ' '
							}
						])
						.run();

					// Move cursor to end of insertion
					editor.view.dom.ownerDocument.defaultView?.getSelection()?.collapseToEnd();
				},
				allow: ({ state, range }) => {
					const $from = state.doc.resolve(range.from);
					const type = state.schema.nodes.citation;

					return !!$from.parent.type.contentMatch.matchType(type);
				},
				items: ({ query }) => {
					const sources = citationStore.getAllSourcesAsJson();

					if (!query) return Object.values(sources);

					return Object.values(sources).filter((source) => {
						const titleMatch =
							source.title?.toString().toLowerCase().includes(query.toLowerCase()) || false;

						const authorMatch =
							Array.isArray(source.author) && source.author.length > 0
								? source.author.some(
										(author) =>
											author.given.toLowerCase().includes(query.toLowerCase()) ||
											author.family.toLowerCase().includes(query.toLowerCase())
									)
								: false;

						return titleMatch || authorMatch;
					});
				},
				render: () => {
					let component: CitationSuggestion;
					let popup: Instance<Props>[] | null = null;

					return {
						onStart: (props) => {
							console.log(props);
							// Create the component
							component = new CitationSuggestion({
								target: document.createElement('div'),
								props: {
									...props,
									open: true
								}
							});

							if (!props.clientRect) return;

							// Create the popup with tippy
							popup = tippy([document.body], {
								getReferenceClientRect: () => props.clientRect?.() || new DOMRect(0, 0, 0, 0),
								appendTo: () => document.body,
								content: component.$$.root,
								showOnCreate: true,
								interactive: true,
								trigger: 'manual',
								placement: 'bottom-start'
							});
						},
						onUpdate: (props) => {
							component.$set(props);

							if (!props.clientRect || !popup?.[0]) return;

							popup[0].setProps({
								getReferenceClientRect: () => props.clientRect?.() || new DOMRect(0, 0, 0, 0)
							});
						},
						onKeyDown: (props) => {
							if (props.event.key === 'Escape') {
								popup?.[0]?.hide();
								return true;
							}

							return (component.onKeyDown && component.onKeyDown(props)) || false;
						},
						onExit: () => {
							popup?.[0]?.destroy();
							component?.$destroy();
						}
					};
				}
			})
		];
	}
});
