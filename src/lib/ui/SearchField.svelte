<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import Search from '~icons/lucide/search';
	import X from '~icons/lucide/x';

	import Field, { controlClass } from './Field.svelte';

	/**
	 * Words to look for. The label names what is searched ("Search your notes")
	 * and is hidden by default, since the field sits where its panel says so.
	 * Escape clears it, as does the button that appears once there's something
	 * to clear.
	 */
	interface Props extends Omit<HTMLInputAttributes, 'type' | 'id'> {
		label: string;
		hideLabel?: boolean;
		hint?: string;
		error?: string;
		value?: string;
		/** After the field is cleared, by Escape or the button. */
		onclear?: () => void;
	}

	let {
		label,
		hideLabel = true,
		hint,
		error,
		value = $bindable(''),
		onclear,
		disabled,
		class: extra,
		onkeydown,
		...rest
	}: Props = $props();

	let input: HTMLInputElement | undefined = $state();

	function clear() {
		value = '';
		onclear?.();
		input?.focus();
	}
</script>

<Field {label} {hideLabel} {hint} {error}>
	{#snippet control(field)}
		<div class="relative">
			<Search
				class="text-ink-faint pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
				aria-hidden="true"
			/>
			<input
				bind:this={input}
				type="search"
				bind:value
				{disabled}
				class={[controlClass, 'h-(--row-height) pr-7 pl-7', extra]}
				onkeydown={(event) => {
					onkeydown?.(event);
					if (event.key === 'Escape' && value !== '') {
						event.preventDefault();
						event.stopPropagation();
						clear();
					}
				}}
				{...rest}
				{...field}
			/>
			{#if value && !disabled}
				<button
					type="button"
					class="text-ink-muted hover:text-ink hover:bg-surface-hover absolute top-1/2 right-1 grid size-5 -translate-y-1/2 place-items-center rounded"
					aria-label="Clear search"
					onclick={clear}
				>
					<X class="size-3" aria-hidden="true" />
				</button>
			{/if}
		</div>
	{/snippet}
</Field>

<style>
	/* The browser's own clear button would be a second one. */
	input[type='search']::-webkit-search-cancel-button {
		appearance: none;
	}
</style>
