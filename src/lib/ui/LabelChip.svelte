<script lang="ts">
	/**
	 * A highlight label: the dot **and** the name, always (docs/ux.md: colour is
	 * never the only channel). A reader who can't tell the yellow from the
	 * orange still reads "Claim".
	 */
	interface Props {
		name: string;
		/** The label's own colour, as HSL channels ("45 90% 60%"): the reader's choice, not a token. */
		colour: string;
	}

	let { name, colour }: Props = $props();
</script>

<span class="text-caption text-ink-muted inline-flex min-w-0 items-center gap-1.5">
	<span class="size-2 shrink-0 rounded-full" style:background="hsl({colour})" aria-hidden="true"
	></span>
	<span class="truncate">{name}</span>
</span>
