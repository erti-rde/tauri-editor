<script lang="ts">
	import { mergeProps } from 'bits-ui';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	import type { IconComponent } from './icon';
	import Tooltip from './Tooltip.svelte';
	import { variants } from './variants';

	interface Props extends Omit<HTMLButtonAttributes, 'aria-label' | 'children'> {
		/**
		 * What it does, as an action: "Close settings". Required, because an icon
		 * isn't self-evident: this is both the tooltip and the accessible name.
		 */
		label: string;
		icon: IconComponent;
		/** Keyboard shortcut, shown in the tooltip. */
		shortcut?: string;
		/** On, for a toggle such as Bold. Read as `aria-pressed`. */
		pressed?: boolean;
		size?: 'sm' | 'md';
		side?: 'top' | 'bottom' | 'left' | 'right';
	}

	let {
		label,
		icon: Icon,
		shortcut,
		pressed,
		size = 'md',
		side,
		disabled = false,
		type = 'button',
		class: extra,
		...rest
	}: Props = $props();

	const iconButton = variants({
		base: 'inline-flex shrink-0 items-center justify-center rounded text-ink-muted transition-colors duration-(--duration-fast) ease-standard enabled:hover:bg-surface-hover enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:bg-accent-quiet aria-pressed:text-accent',
		variants: {
			size: { sm: 'size-5', md: 'size-(--row-height)' }
		},
		defaults: { size: 'md' }
	});
</script>

<Tooltip {label} {shortcut} {side}>
	{#snippet children(trigger)}
		<button
			{type}
			{disabled}
			aria-pressed={pressed}
			class={iconButton({ size }, typeof extra === 'string' ? extra : undefined)}
			{...mergeProps(rest, trigger)}
		>
			<Icon class={size === 'sm' ? 'size-3.5' : 'size-4'} aria-hidden="true" />
		</button>
	{/snippet}
</Tooltip>
