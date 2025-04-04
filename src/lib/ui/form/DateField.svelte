<script lang="ts">
	import { DateField, type WithoutChildrenOrChild } from 'bits-ui';

	type Props = WithoutChildrenOrChild<DateField.RootProps> & {
		labelText: string;
	};

	let { value, placeholder, labelText, ...restProps }: Props = $props();
</script>

<DateField.Root
	bind:value
	bind:placeholder
	class="w-full rounded-md border border-gray-300 p-2"
	{...restProps}
>
	<DateField.Label class="mb-1 block text-sm font-medium text-gray-700">{labelText}</DateField.Label
	>
	<DateField.Input class="w-full rounded-md border border-gray-300 p-2 data-invalid:border-red-400">
		{#snippet children({ segments })}
			{#each segments as { part, value }, i (i)}
				<DateField.Segment {part}>
					{value}
				</DateField.Segment>
			{/each}
		{/snippet}
	</DateField.Input>
</DateField.Root>
