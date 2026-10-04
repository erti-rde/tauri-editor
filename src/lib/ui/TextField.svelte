<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	import Field, { controlClass } from './Field.svelte';

	interface Props extends Omit<HTMLInputAttributes, 'type' | 'id'> {
		label: string;
		hideLabel?: boolean;
		hint?: string;
		error?: string;
		value?: string;
		type?: 'text' | 'email' | 'url' | 'tel';
	}

	let {
		label,
		hideLabel,
		hint,
		error,
		value = $bindable(''),
		type = 'text',
		class: extra,
		...rest
	}: Props = $props();
</script>

<Field {label} {hideLabel} {hint} {error}>
	{#snippet control(field)}
		<input
			{type}
			bind:value
			class={[controlClass, 'h-(--row-height) px-2', extra]}
			{...rest}
			{...field}
		/>
	{/snippet}
</Field>
