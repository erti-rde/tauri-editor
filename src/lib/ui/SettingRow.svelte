<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * One setting: a label, a one-line hint and its control, with a rule above
	 * (M5-10).
	 *
	 * The control sits to the right, or below the label when it's a group of
	 * cards (`stacked`). Rows follow one another with a rule between them and no
	 * card around each: Settings is a list, not a dashboard.
	 *
	 * The label isn't a `<label>`, since a row's control is often a button or a
	 * group, which a `<label>` can't name. The control gets the ids instead, as
	 * `aria-labelledby` and `aria-describedby`, from the snippet's argument.
	 */
	interface Props {
		label: string;
		/** One line on what it does or what it holds. */
		hint?: string;
		/** The control below the label, for a group of cards. */
		stacked?: boolean;
		children: Snippet<[{ labelId: string; hintId: string | undefined }]>;
	}

	let { label, hint, stacked = false, children }: Props = $props();

	const id = $props.id();
	const labelId = `${id}-label`;
	const hintId = $derived(hint ? `${id}-hint` : undefined);
</script>

<div
	class={[
		'border-line border-t py-3',
		stacked ? 'grid gap-2' : 'flex items-center justify-between gap-6'
	]}
>
	<!-- A long hint (a path) wraps anywhere rather than pushing the control
	     off the row. -->
	<div class="grid min-w-0 flex-1 gap-0.5">
		<span id={labelId} class="text-small text-ink font-medium">{label}</span>
		{#if hint}
			<span id={hintId} class="text-caption text-ink-muted wrap-anywhere">{hint}</span>
		{/if}
	</div>
	<div class={stacked ? 'min-w-0' : 'flex shrink-0 flex-wrap items-center gap-2'}>
		{@render children({ labelId, hintId })}
	</div>
</div>
