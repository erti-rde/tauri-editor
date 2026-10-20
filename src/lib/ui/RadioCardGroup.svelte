<script lang="ts">
	import type { Snippet } from 'svelte';
	import { RadioGroup } from 'bits-ui';

	/**
	 * A choice among a few cards, each a `RadioCard` (M5-10).
	 *
	 * For options that need more than a line: a palette's swatch, a backup's
	 * date and what it was taken before. Arrow keys move between cards, as in
	 * every `RadioGroup`. Named by `aria-labelledby` when it sits in a
	 * `SettingRow`, or by `label`.
	 */
	interface Props {
		/** The group's name, when nothing on screen gives it one. */
		label?: string;
		'aria-labelledby'?: string;
		'aria-describedby'?: string;
		value?: string;
		/** Cards side by side; a long list stays one to a row. */
		columns?: 1 | 2 | 3 | 4;
		disabled?: boolean;
		onValueChange?: (value: string) => void;
		children: Snippet;
	}

	let {
		label,
		value = $bindable(''),
		columns = 2,
		disabled = false,
		onValueChange,
		children,
		...rest
	}: Props = $props();

	const COLUMNS = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' };
</script>

<RadioGroup.Root
	bind:value
	{disabled}
	{onValueChange}
	aria-label={label}
	{...rest}
	class={['grid gap-2', COLUMNS[columns]]}
>
	{@render children()}
</RadioGroup.Root>
