import tippy from 'tippy.js';
import SvelteRenderer from '../../core/SvelteRenderer';
import CitationSuggestion from './CitationSuggestion.svelte';

import { parseCitationIds } from '$lib/citations/document';
import { citationStore } from '$lib/stores/citationStore';

import type { Editor } from '@tiptap/core';
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';

import { mount, type ComponentProps } from 'svelte';
import type { Instance, Props } from 'tippy.js';

export const suggestion = (editor: Editor): SuggestionOptions => ({
	editor,
	command: ({ editor, range, props }) => {
		// Get the formatted citation text from our store
		// Provisional. Inserting runs a document render, which is what makes the
		// citation correct with respect to everything else cited.
		const citationText = citationStore.previewCitation(parseCitationIds(props.id));

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
			// No re-render here: inserting changes the document, and the extension's
			// plugin re-renders every citation off the back of that. Chaining it
			// would render twice, and would only ever cover the insertion paths
			// someone remembered to chain it onto.
			.run();

		// Move cursor to end of insertion
		editor.view.dom.ownerDocument.defaultView?.getSelection()?.collapseToEnd();
	},
	allow: ({ state, range }) => {
		const from = state.doc.resolve(range.from);
		const type = state.schema.nodes.citation;

		return !!from.parent.type.contentMatch.matchType(type);
	},
	items: ({ query }) => {
		const sources = citationStore.getAllSourcesAsJson();

		if (!query) return Object.values(sources);

		const wanted = query.toLowerCase();
		const matches = (text: unknown) =>
			typeof text === 'string' && text.toLowerCase().includes(wanted);

		// An organisation is an author with only `literal`, and CSL makes no
		// promise of the other two; reading `given` off it threw, and the picker
		// stopped offering anything past the first letter typed.
		return Object.values(sources).filter(
			(source) =>
				matches(source.title) ||
				(Array.isArray(source.author) &&
					source.author.some(
						(author) => matches(author.given) || matches(author.family) || matches(author.literal)
					))
		);
	},
	render: () => {
		let wrapper: HTMLElement;
		let component: CitationSuggestion;
		let componentProps: ComponentProps<typeof CitationSuggestion> = $state(null!);
		let popup: Instance<Props>[] | null = null;
		// This renderer drives a detached suggestion popup, not a node view, so it
		// carries TipTap's SuggestionProps rather than NodeViewProps.
		let renderer: SvelteRenderer<SuggestionProps>;

		return {
			onStart: (props) => {
				const { editor } = props;

				wrapper = document.createElement('div');
				editor.view.dom.parentNode?.appendChild(wrapper);
				componentProps = {
					items: props.items,
					query: props.query,
					// The caret stays in the manuscript; it's told which option is active.
					owner: editor.view.dom,
					cl: (itemId) => {
						props.command({ id: itemId });
					}
				};
				component = mount(CitationSuggestion, {
					target: wrapper,
					props: componentProps
				});

				renderer = new SvelteRenderer(component, { element: wrapper, props });

				if (!props.clientRect) return;

				// Create the popup with tippy
				popup = tippy([document.body], {
					getReferenceClientRect: () => props.clientRect?.() || new DOMRect(0, 0, 0, 0),
					appendTo: () => document.body,
					content: renderer.dom,
					showOnCreate: true,
					interactive: true,
					trigger: 'manual',
					placement: 'bottom-start'
				});
			},
			onUpdate: (props) => {
				componentProps.items = props.items;
				componentProps.query = props.query;
				// `props.command` is bound to the suggestion's current range, so the
				// callback captured in onStart goes stale as soon as the user types
				// another character — selecting an item would then insert at the old
				// range. Rebind it alongside the items.
				componentProps.cl = (itemId) => {
					props.command({ id: itemId });
				};
				renderer?.updateProps(props);

				if (!props.clientRect || !popup?.[0]) return;

				popup[0].setProps({
					getReferenceClientRect: () => props.clientRect?.() || new DOMRect(0, 0, 0, 0)
				});
			},
			onKeyDown: (props) => {
				if (props.event.key === 'Escape') {
					popup?.[0]?.hide();
					component.dismiss();
					return true;
				}

				return (component.onKeyDown && component.onKeyDown(props)) || false;
			},
			onExit: () => {
				popup?.[0]?.destroy();
				renderer?.destroy();
				wrapper.remove();
			}
		};
	}
});

export default suggestion;
