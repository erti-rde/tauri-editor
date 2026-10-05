<script lang="ts" module>
	import { variants } from './variants';

	// Below the floating layer (z-50): a menu, select or tooltip opened inside a
	// dialog draws over it, and so does a toast the dialog raises.
	const surface = variants({
		base: 'bg-surface-raised border-line-strong shadow-overlay fixed top-1/2 left-1/2 z-40 flex max-h-[90vh] max-w-[90%] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border outline-hidden',
		variants: {
			size: {
				// A decision: one question and its consequences.
				sm: 'w-115',
				md: 'w-140',
				// A workspace of its own, such as Settings.
				lg: 'h-136 w-200'
			}
		},
		defaults: { size: 'md' }
	});
</script>

<script lang="ts">
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import X from '~icons/lucide/x';

	/**
	 * A modal. bits-ui gives it the behaviour a modal must have: focus moves in
	 * and is trapped there, Escape closes it, focus goes back to whatever opened
	 * it, and the page behind is inert.
	 */
	interface Props {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		/** Read as the dialog's name. */
		title: string;
		/** One line under the title, read as the dialog's description. */
		description?: string;
		/** The close button's name, when "Close" alone is ambiguous. */
		closeLabel?: string;
		size?: 'sm' | 'md' | 'lg';
		/** The body without padding, for content that lays itself out (tabs). */
		flush?: boolean;
		children: Snippet;
		/** Actions, right-aligned; the primary one last. */
		footer?: Snippet;
		/**
		 * Whether Escape, a click outside and the close button dismiss it. Off
		 * while something it started is under way.
		 */
		dismissible?: boolean;
		/**
		 * Where focus goes on opening, when not the first control (the close
		 * button): prevent the event's default, and focus it.
		 */
		onOpenAutoFocus?: (event: Event) => void;
	}

	let {
		open = $bindable(false),
		onOpenChange,
		title,
		description,
		closeLabel = 'Close',
		size,
		flush = false,
		children,
		footer,
		dismissible = true,
		onOpenAutoFocus
	}: Props = $props();
</script>

<Dialog.Root bind:open {onOpenChange}>
	<Dialog.Portal>
		<Dialog.Overlay class="bg-backdrop fixed inset-0 z-40" />
		<Dialog.Content
			class={surface({ size })}
			escapeKeydownBehavior={dismissible ? 'close' : 'ignore'}
			interactOutsideBehavior={dismissible ? 'close' : 'ignore'}
			{onOpenAutoFocus}
		>
			<div class="border-line flex items-start justify-between gap-3 border-b px-5 py-3">
				<div class="grid gap-0.5">
					<Dialog.Title class="text-title text-ink font-semibold">{title}</Dialog.Title>
					{#if description}
						<Dialog.Description class="text-small text-ink-muted">{description}</Dialog.Description>
					{/if}
				</div>
				<Dialog.Close
					aria-label={closeLabel}
					disabled={!dismissible}
					class="text-ink-muted hover:bg-surface-hover hover:text-ink grid size-(--row-height) shrink-0 place-items-center rounded transition-colors duration-(--duration-fast) disabled:opacity-50"
				>
					<X class="size-4" aria-hidden="true" />
				</Dialog.Close>
			</div>

			<div class={['min-h-0 flex-1', flush ? 'flex' : 'overflow-y-auto px-5 py-4']}>
				{@render children()}
			</div>

			{#if footer}
				<div class="border-line bg-surface-sunken flex justify-end gap-2 border-t px-5 py-3">
					{@render footer()}
				</div>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
