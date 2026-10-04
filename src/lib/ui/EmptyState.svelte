<script lang="ts">
	import Button from './Button.svelte';

	/**
	 * Nothing to show, and which kind of nothing (docs/ux.md principle 3):
	 * nothing yet, nothing matches, or the asking failed. Each says so in its
	 * own words, since a blank panel can't be acted on.
	 */
	interface Props {
		/** What there is none of, or what went wrong: "No notes match “attention”." */
		message: string;
		/** What to do about it. */
		detail?: string;
		/** At most one thing to do: "Clear the search". */
		action?: { label: string; onclick: () => void };
	}

	let { message, detail, action }: Props = $props();
</script>

<!-- Not a live region: an empty panel is something to find, not to be told
     about on opening. -->
<div class="grid justify-items-center gap-1.5 px-4 py-8 text-center">
	<p class="text-body text-ink">{message}</p>
	{#if detail}
		<p class="text-small text-ink-muted max-w-64">{detail}</p>
	{/if}
	{#if action}
		<Button size="sm" class="mt-1.5" onclick={action.onclick}>{action.label}</Button>
	{/if}
</div>
