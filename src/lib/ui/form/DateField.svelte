<script lang="ts">
	import { DateField, type WithoutChildrenOrChild } from 'bits-ui';

	type Props = WithoutChildrenOrChild<DateField.RootProps> & {
		labelText: string;
	};

	let { value, placeholder, labelText, ...restProps }: Props = $props();
</script>

<DateField.Root bind:value bind:placeholder {...restProps}>
	<DateField.Label class="text-ink mb-1 block text-sm font-medium">{labelText}</DateField.Label>
	<DateField.Input
		class="border-line-strong data-invalid:border-danger w-full rounded-md border p-2"
	>
		{#snippet children({ segments })}
			{#each segments as { part, value }, i (i)}
				<DateField.Segment {part}>
					{value}
				</DateField.Segment>
			{/each}
		{/snippet}
	</DateField.Input>
</DateField.Root>
