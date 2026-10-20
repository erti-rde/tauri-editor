<script lang="ts">
	import type { Snippet } from 'svelte';
	import { RadioGroup } from 'bits-ui';
	import Check from '~icons/lucide/check';

	/**
	 * One card in a `RadioCardGroup` (M5-10).
	 *
	 * Checked is said three ways: an accent edge, the accent-quiet ground, and a
	 * check, with the words staying ink (design-system rule 6: accent text on
	 * accent-quiet is what missed 4.5:1).
	 */
	interface Props {
		value: string;
		label: string;
		/** A second line: what it is, or when. */
		description?: string;
		disabled?: boolean;
		/** Drawn before the words: a palette's swatch. */
		leading?: Snippet;
		/** For the grid: `col-span-2` for a card that leads the group. */
		class?: string;
	}

	let { value, label, description, disabled = false, leading, class: extra }: Props = $props();
</script>

<RadioGroup.Item
	{value}
	{disabled}
	class={[
		'border-line-control bg-surface-raised text-ink hover:bg-surface-hover relative flex min-w-0 items-center gap-2.5 rounded border py-2 pr-6 pl-2.5 text-left transition-colors',
		'data-[state=checked]:border-accent data-[state=checked]:bg-accent-quiet',
		'disabled:cursor-not-allowed disabled:opacity-50',
		extra
	]}
>
	{#snippet children({ checked })}
		{#if leading}{@render leading()}{/if}
		<span class="grid min-w-0 gap-0.5">
			<span class="text-small truncate font-medium">{label}</span>
			{#if description}
				<span class="text-caption text-ink-muted">{description}</span>
			{/if}
		</span>
		{#if checked}
			<Check class="text-accent absolute top-1.5 right-1.5 size-3" aria-hidden="true" />
		{/if}
	{/snippet}
</RadioGroup.Item>
