<script lang="ts" module>
	import { variants } from './variants';

	/**
	 * The look of a button, for the few places that must style another element
	 * as one (a bits-ui trigger). Everything else uses `Button`.
	 */
	export const buttonClass = variants({
		base: 'inline-flex shrink-0 items-center justify-center gap-1.5 rounded border whitespace-nowrap font-medium transition-colors duration-(--duration-fast) ease-standard disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress',
		variants: {
			variant: {
				// Once per view: the thing this view is for.
				primary: 'bg-accent border-accent text-accent-ink enabled:hover:bg-accent-hover',
				secondary:
					'bg-surface-raised border-line-strong text-ink enabled:hover:bg-surface-hover enabled:active:bg-surface-active',
				ghost:
					'border-transparent bg-transparent text-ink-muted enabled:hover:bg-surface-hover enabled:hover:text-ink',
				// Says the verb ("Remove"), and sits last.
				danger: 'bg-danger border-danger text-accent-ink enabled:hover:opacity-90'
			},
			size: {
				sm: 'h-5 px-2 text-caption',
				md: 'h-(--row-height) px-2.5 text-small'
			}
		},
		defaults: { variant: 'secondary', size: 'md' }
	});
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Spinner from '~icons/lucide/loader-circle';

	interface Props extends HTMLButtonAttributes {
		variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
		size?: 'sm' | 'md';
		/**
		 * Working. The button can't be pressed again, says so to a screen reader
		 * with `aria-busy`, and keeps its words: "Adding…" reads better than a
		 * spinner alone, so the caller can change the label too.
		 */
		loading?: boolean;
		children: Snippet;
	}

	let {
		variant,
		size,
		loading = false,
		disabled = false,
		type = 'button',
		class: extra,
		children,
		...rest
	}: Props = $props();
</script>

<button
	{type}
	class={buttonClass({ variant, size }, typeof extra === 'string' ? extra : undefined)}
	disabled={disabled || loading}
	aria-busy={loading || undefined}
	{...rest}
>
	{#if loading}
		<Spinner class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
	{/if}
	{@render children()}
</button>
