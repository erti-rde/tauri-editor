<script lang="ts" module>
	import { variants } from './variants';

	const banner = variants({
		base: 'text-small text-ink bg-surface-sunken flex items-start gap-2 rounded border-l-2 px-3 py-2',
		variants: {
			tone: {
				info: 'border-accent',
				success: 'border-success',
				warning: 'border-warning',
				danger: 'border-danger'
			}
		},
		defaults: { tone: 'info' }
	});
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import Info from '~icons/lucide/info';
	import CircleCheck from '~icons/lucide/circle-check';
	import TriangleAlert from '~icons/lucide/triangle-alert';
	import CircleX from '~icons/lucide/circle-x';

	import Button from './Button.svelte';

	/**
	 * Something that needs attention where it is: a manuscript from a newer
	 * Erti, a style that failed to load. The tone is in an icon and the words
	 * too, never the colour alone.
	 */
	interface Props {
		tone?: 'info' | 'success' | 'warning' | 'danger';
		/** At most one thing to do about it. */
		action?: { label: string; onclick: () => void };
		children: Snippet;
	}

	let { tone = 'info', action, children }: Props = $props();

	const icons = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleX };
	const colours = {
		info: 'text-accent',
		success: 'text-success',
		warning: 'text-warning',
		danger: 'text-danger'
	};
	const Icon = $derived(icons[tone]);
</script>

<!-- A danger banner is an alert, read at once; the rest are status, read when
     the reader gets to them. -->
<div class={banner({ tone })} role={tone === 'danger' ? 'alert' : 'status'}>
	<Icon class={['mt-px size-4 shrink-0', colours[tone]]} aria-hidden="true" />
	<div class="flex-1">{@render children()}</div>
	{#if action}
		<Button size="sm" onclick={action.onclick}>{action.label}</Button>
	{/if}
</div>
