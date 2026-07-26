import type { NodeViewProps } from '@tiptap/core';
import { mount, unmount } from 'svelte';

/**
 * Props this renderer carries. It is used both for real node views (where the
 * props are TipTap's `NodeViewProps`) and for detached popups such as the
 * citation suggestion list, which pass their own shape — hence the generic.
 */
interface RendererOptions<P> {
	element: HTMLElement;
	props: P;
}

type App = ReturnType<typeof mount>;

class SvelteRenderer<P = NodeViewProps> {
	component: App;
	props: P;
	dom: HTMLElement;

	constructor(component: App, { element, props }: RendererOptions<P>) {
		this.component = component;
		this.props = props;
		this.dom = element;

		this.dom.classList.add('svelte-renderer');
	}

	updateProps(props: Partial<P>): void {
		Object.assign(this.props as object, props);
	}

	updateAttributes(attributes: Record<string, string>): void {
		Object.keys(attributes).forEach((key) => {
			this.dom.setAttribute(key, attributes[key]);
		});
	}

	destroy(): void {
		unmount(this.component);
	}
}

export default SvelteRenderer;
