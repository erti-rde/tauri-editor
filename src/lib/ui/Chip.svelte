<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A short fact beside something: "Book", "Not in this project", "2 files". */
	interface Props {
		children: Snippet;
		/** The accent, for the one chip that should draw the eye. */
		tone?: 'neutral' | 'accent';
	}

	let { children, tone = 'neutral' }: Props = $props();
</script>

<span
	class={[
		'text-caption inline-flex items-center rounded-full border px-1.5 whitespace-nowrap',
		tone === 'accent'
			? 'border-accent bg-accent-quiet text-ink'
			: 'border-line-strong text-ink-muted'
	]}
>
	{@render children()}
</span>
