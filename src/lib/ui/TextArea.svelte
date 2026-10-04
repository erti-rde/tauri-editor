<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	import Field, { controlClass } from './Field.svelte';

	interface Props extends Omit<HTMLTextareaAttributes, 'id'> {
		label: string;
		hideLabel?: boolean;
		hint?: string;
		error?: string;
		value?: string;
	}

	let {
		label,
		hideLabel,
		hint,
		error,
		value = $bindable(''),
		rows = 3,
		class: extra,
		...rest
	}: Props = $props();
</script>

<Field {label} {hideLabel} {hint} {error}>
	{#snippet control(field)}
		<textarea
			bind:value
			{rows}
			class={[controlClass, 'min-h-(--row-height) resize-y px-2 py-1.5', extra]}
			{...rest}
			{...field}></textarea>
	{/snippet}
</Field>
