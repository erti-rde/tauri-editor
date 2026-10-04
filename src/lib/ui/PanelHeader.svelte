<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The top of a rail panel: its title, at most one primary action, and a
	 * scope line saying what the list below covers ("This project · 42 notes").
	 * Anything else that belongs above the list (a search field) goes in
	 * `children`.
	 */
	interface Props {
		title: string;
		/** The heading's id, so the panel can be named by it. */
		id?: string;
		scope?: string;
		action?: Snippet;
		children?: Snippet;
	}

	let { title, id, scope, action, children }: Props = $props();
</script>

<header class="border-line grid gap-2 border-b px-3 py-2.5">
	<div class="flex items-center gap-2">
		<h2 {id} class="text-body text-ink flex-1 truncate font-semibold">{title}</h2>
		{@render action?.()}
	</div>
	{#if scope}
		<p class="text-caption text-ink-muted">{scope}</p>
	{/if}
	{@render children?.()}
</header>
