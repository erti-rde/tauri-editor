<script lang="ts" module>
	/** What a control needs to be named and described by its field. */
	export interface FieldControl {
		id: string;
		'aria-describedby'?: string;
		'aria-invalid'?: true;
	}

	/** The box every text control is drawn in. */
	export const controlClass =
		'w-full rounded border border-line-strong bg-surface-raised text-small text-ink placeholder:text-ink-faint transition-colors duration-(--duration-fast) ease-standard enabled:hover:border-ink-faint disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A label, the control, and a line under it: the hint, or the error in its
	 * place. Shared by `TextField`, `TextArea` and `SearchField`, so a label is
	 * never forgotten and an error is always tied to its control.
	 */
	interface Props {
		label: string;
		/** Kept for screen readers and hidden on screen, where the context names it. */
		hideLabel?: boolean;
		hint?: string;
		/** What's wrong and how to fix it: "Enter a DOI, such as 10.1000/xyz". */
		error?: string;
		control: Snippet<[FieldControl]>;
	}

	let { label, hideLabel = false, hint, error, control }: Props = $props();

	const id = $props.id();
	const note = $derived(error ?? hint);
</script>

<div class="grid gap-1">
	<label for={id} class={hideLabel ? 'sr-only' : 'text-small text-ink font-medium'}>{label}</label>
	{@render control({
		id,
		...(note ? { 'aria-describedby': `${id}-note` } : {}),
		...(error ? { 'aria-invalid': true as const } : {})
	})}
	{#if note}
		<p
			id="{id}-note"
			class={['text-caption', error ? 'text-danger' : 'text-ink-muted']}
			aria-live={error ? 'polite' : undefined}
		>
			{note}
		</p>
	{/if}
</div>
