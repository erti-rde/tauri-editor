<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import type { Snippet } from 'svelte';

	/**
	 * What a toolbar button does.
	 *
	 * The toolbar is twenty-two icons and, until now, one `title` attribute
	 * between them — so most of it could only be learned by clicking and seeing
	 * what happened to your manuscript. Icons are not self-evident: the
	 * difference between a page break and a horizontal rule is not something you
	 * can read off a glyph.
	 *
	 * Built on bits-ui's Tooltip rather than `title`, which cannot be styled,
	 * appears after an unconfigurable delay, and is not shown on keyboard focus.
	 * The label is also attached as an accessible name, so a screen reader gets
	 * it whether or not the tooltip is on screen.
	 *
	 * Timing comes from the provider at the app root, so moving along a toolbar
	 * does not replay the delay at every button.
	 */

	interface Props {
		/** What the control does. Written as an action: "Insert a page break". */
		label: string;
		/** Keyboard shortcut, shown after the label. */
		shortcut?: string;
		side?: 'top' | 'bottom' | 'left' | 'right';
		/**
		 * The control itself, given the trigger's props to spread onto its own
		 * single root element — which then *becomes* the trigger.
		 *
		 * Not optional, and not a convenience. Rendering the control inside a
		 * `Tooltip.Trigger` puts a `<button>` inside a `<button>`, which is invalid
		 * HTML: the parser closes the outer one early, so the two end up siblings
		 * and the trigger's listeners sit on an element that no longer wraps
		 * anything. Delegation gives one element with both sets of props.
		 */
		children: Snippet<[Record<string, unknown>]>;
	}

	const { label, shortcut, side = 'bottom', children }: Props = $props();
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			<!-- The name rides on the control, so a screen reader reads it whether or
			     not the tooltip is on screen. A consumer that sets its own wins. -->
			{@render children({ 'aria-label': label, ...props })}
		{/snippet}
	</Tooltip.Trigger>

	<Tooltip.Portal>
		<Tooltip.Content
			{side}
			sideOffset={6}
			class="border-line bg-surface-overlay text-ink z-50 flex items-center gap-2 rounded border px-2 py-1 text-[11px] shadow-md"
		>
			<span>{label}</span>
			{#if shortcut}
				<!-- Monospaced, because a shortcut is characters to be typed exactly
				     and proportional digits make that harder to read at 11px. -->
				<kbd class="border-line text-ink-muted rounded border px-1 font-mono text-[10px]">
					{shortcut}
				</kbd>
			{/if}
		</Tooltip.Content>
	</Tooltip.Portal>
</Tooltip.Root>
