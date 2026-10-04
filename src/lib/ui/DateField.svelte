<script lang="ts">
	import { DateField, type WithoutChildrenOrChild } from 'bits-ui';

	import { controlClass } from './Field.svelte';

	/** A date, typed a part at a time; arrow keys step each part. */
	type Props = WithoutChildrenOrChild<DateField.RootProps> & {
		label: string;
		hideLabel?: boolean;
	};

	let {
		value = $bindable(),
		placeholder = $bindable(),
		label,
		hideLabel = false,
		...restProps
	}: Props = $props();
</script>

<DateField.Root bind:value bind:placeholder {...restProps}>
	<div class="grid gap-1">
		<DateField.Label class={hideLabel ? 'sr-only' : 'text-small text-ink font-medium'}>
			{label}
		</DateField.Label>
		<DateField.Input
			class={[
				controlClass,
				'data-invalid:border-danger flex h-(--row-height) items-center px-2 data-disabled:cursor-not-allowed data-disabled:opacity-50'
			]}
		>
			{#snippet children({ segments })}
				{#each segments as { part, value }, i (i)}
					<DateField.Segment
						{part}
						class="focus:bg-accent-quiet focus:text-ink data-[segment=literal]:text-ink-faint rounded-sm px-px tabular-nums outline-none"
					>
						{value}
					</DateField.Segment>
				{/each}
			{/snippet}
		</DateField.Input>
	</div>
</DateField.Root>
