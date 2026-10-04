<script lang="ts">
	import { Popover } from 'bits-ui';
	import type { Snippet } from 'svelte';

	import { buttonClass } from './Button.svelte';

	/**
	 * Extra detail or a small form, on demand. Never the only copy of something
	 * the reader needs. Escape and a click outside close it.
	 */
	interface Props {
		/** The trigger's name, and the content's. */
		label: string;
		/** What the trigger shows. The label, by default. */
		trigger?: Snippet;
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		side?: 'top' | 'bottom' | 'left' | 'right';
		align?: 'start' | 'center' | 'end';
		disabled?: boolean;
		children: Snippet;
	}

	let {
		label,
		trigger,
		open = $bindable(false),
		onOpenChange,
		side = 'bottom',
		align = 'start',
		disabled = false,
		children
	}: Props = $props();
</script>

<Popover.Root bind:open {onOpenChange}>
	<Popover.Trigger
		aria-label={trigger ? label : undefined}
		{disabled}
		class={buttonClass({ variant: 'ghost', size: 'md' }, 'px-1')}
	>
		{#if trigger}
			{@render trigger()}
		{:else}
			{label}
		{/if}
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content
			{side}
			{align}
			sideOffset={4}
			aria-label={label}
			class="shadow-overlay bg-surface-raised border-line-strong text-small text-ink z-50 max-w-80 rounded-lg border p-3 outline-hidden"
		>
			{@render children()}
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
