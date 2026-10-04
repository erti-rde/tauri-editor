<script lang="ts">
	import type { Snippet } from 'svelte';

	import PanelHeader from './PanelHeader.svelte';

	/**
	 * A rail panel: Files, Outline, Notes, Sources. A header, then a list that
	 * scrolls on its own while the header stays put. Named by its title, so a
	 * screen reader can jump between panels as regions.
	 */
	interface Props {
		title: string;
		scope?: string;
		/** At most one primary action, beside the title. */
		action?: Snippet;
		/** Under the title: a search field, filters. */
		header?: Snippet;
		children: Snippet;
	}

	let { title, scope, action, header, children }: Props = $props();

	const id = $props.id();
</script>

<section aria-labelledby={id} class="bg-surface flex h-full min-h-0 flex-col">
	<PanelHeader {id} {title} {scope} {action} children={header} />
	<div class="min-h-0 flex-1 overflow-y-auto">
		{@render children()}
	</div>
</section>
