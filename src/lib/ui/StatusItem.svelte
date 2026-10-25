<script lang="ts">
	import type { Snippet } from 'svelte';
	import Check from '~icons/lucide/check';
	import CircleAlert from '~icons/lucide/circle-alert';
	import LoaderCircle from '~icons/lucide/loader-circle';
	import TriangleAlert from '~icons/lucide/triangle-alert';

	import type { IconComponent } from './icon';

	/**
	 * One fact in the status bar: "4,812 words", "Saved", "Processing PDFs:
	 * 3/10".
	 *
	 * The tone's icon carries the colour and the words stay in the bar's ink,
	 * so nothing is said by colour alone. An error's words are full ink, since
	 * they say what failed. Counts line up in tabular figures.
	 */
	interface Props {
		tone?: 'neutral' | 'busy' | 'success' | 'warning' | 'danger';
		/** In place of the tone's own icon. */
		icon?: IconComponent;
		/** More, on hover: what a count includes. Never the only copy of it. */
		title?: string;
		children: Snippet;
	}

	let { tone = 'neutral', icon, title, children }: Props = $props();

	const TONE_ICONS: Record<NonNullable<Props['tone']>, IconComponent | undefined> = {
		neutral: undefined,
		busy: LoaderCircle,
		success: Check,
		warning: TriangleAlert,
		danger: CircleAlert
	};

	const Icon = $derived(icon ?? TONE_ICONS[tone]);
</script>

<span
	{title}
	class={[
		'inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums',
		tone === 'danger' && 'text-ink'
	]}
>
	{#if Icon}
		<Icon
			class={[
				'size-3 shrink-0',
				tone === 'busy' && 'motion-safe:animate-spin',
				tone === 'success' && 'text-success',
				tone === 'warning' && 'text-warning',
				tone === 'danger' && 'text-danger'
			]}
			aria-hidden="true"
		/>
	{/if}
	{@render children()}
</span>
