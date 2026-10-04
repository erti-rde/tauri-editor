<script lang="ts">
	import type { Snippet } from 'svelte';
	import X from '~icons/lucide/x';

	/**
	 * The right-hand detail view: a source's details, a note. Not modal, so the
	 * page beside it stays usable; Escape inside it closes it, as does the
	 * close button.
	 */
	interface Props {
		title: string;
		/** A line under the title: "Book · Ong, W. J. · 1982". */
		subtitle?: string;
		onclose: () => void;
		/** Under the title: tabs, a toolbar. */
		header?: Snippet;
		children: Snippet;
	}

	let { title, subtitle, onclose, header, children }: Props = $props();

	const id = $props.id();
</script>

<!-- Escape is handled for whatever has focus inside, as a dialog would; the
     aside itself never takes focus. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside
	aria-labelledby={id}
	class="border-line bg-surface flex h-full min-h-0 w-82 shrink-0 flex-col border-l"
	onkeydown={(event) => {
		if (event.key === 'Escape' && !event.defaultPrevented) {
			event.preventDefault();
			onclose();
		}
	}}
>
	<header class="border-line grid gap-2 border-b px-3 py-2.5">
		<div class="flex items-start gap-2">
			<div class="grid flex-1 gap-0.5">
				<h2 {id} class="text-body text-ink font-semibold">{title}</h2>
				{#if subtitle}
					<p class="text-caption text-ink-muted">{subtitle}</p>
				{/if}
			</div>
			<button
				type="button"
				aria-label="Close {title}"
				class="text-ink-muted hover:bg-surface-hover hover:text-ink grid size-(--row-height) shrink-0 place-items-center rounded transition-colors duration-(--duration-fast)"
				onclick={onclose}
			>
				<X class="size-4" aria-hidden="true" />
			</button>
		</div>
		{@render header?.()}
	</header>
	<div class="min-h-0 flex-1 overflow-y-auto">
		{@render children()}
	</div>
</aside>
