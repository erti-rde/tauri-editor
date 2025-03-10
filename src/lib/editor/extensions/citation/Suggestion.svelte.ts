import tippy from 'tippy.js';
import SvelteRenderer from '../../core/SvelteRenderer';
import CitationSuggestion from './CitationSuggestion.svelte';

import { citationStore } from '$lib/stores/citationStore';

import type { Editor } from '@tiptap/core';
import type { SuggestionOptions } from '@tiptap/suggestion';

import { mount, type ComponentProps } from 'svelte';
import type { Instance, Props } from 'tippy.js';

export const suggestion = (editor: Editor): SuggestionOptions => ({
	editor,
	command: ({ editor, range, props }) => {
    console.log({ editor, range, props })
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
		const from = state.doc.resolve(range.from);
		const type = state.schema.nodes.citation;

		return !!from.parent.type.contentMatch.matchType(type);
	},
	items: ({ query }) => {
		console.log(`🚀 ~ query:`, query);
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
		let wrapper: HTMLElement;
		let component: CitationSuggestion;
    let componentProps: ComponentProps<typeof CitationSuggestion> = $state(null!)
		let popup: Instance<Props>[] | null = null;
		let renderer: SvelteRenderer;
    
		return {
			onStart: (props) => {
				const { editor } = props;

				wrapper = document.createElement('div');
				editor.view.dom.parentNode?.appendChild(wrapper);
        componentProps = {
          items: props.items,
          cl: (itemId) => {
            props.command({id: itemId})
          }
        }
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
        renderer?.updateProps(props);
				console.log(`🚀 ~ props:`, renderer);

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
				renderer?.destroy();
				wrapper.remove();
			}
		};
	}
});

export default suggestion;
