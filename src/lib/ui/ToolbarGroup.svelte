<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Controls in a `Toolbar` that do one kind of job: undo and redo, the inline
	 * styles, alignment. A line rule sets it off from whatever comes before it, so
	 * "turn the page" and "mark this passage" don't read as the same kind of act.
	 */
	interface Props {
		/** What the group is for, when its controls don't say: "What to mark with". */
		label?: string;
		/** Draw the rule before it. Off where space already separates it. */
		rule?: boolean;
		class?: string;
		children: Snippet;
	}

	let { label, rule = true, class: extra, children }: Props = $props();
</script>

<div
	role="group"
	aria-label={label}
	class={[
		'flex shrink-0 items-center gap-0.5',
		rule &&
			"not-first:before:bg-line not-first:before:mr-1 not-first:before:h-4 not-first:before:w-px not-first:before:content-['']",
		extra
	]}
>
	{@render children()}
</div>
