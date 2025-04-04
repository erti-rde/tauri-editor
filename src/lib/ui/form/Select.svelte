<script lang="ts">
	import { Select, type WithoutChildren } from 'bits-ui';
	import Check from '~icons/lucide/check';
	import ChevronsUpDown from '~icons/lucide/chevrons-up-down';
	import ChevronsUp from '~icons/lucide/chevrons-up';
	import ChevronsDown from '~icons/lucide/chevrons-down';

	type Props = WithoutChildren<Select.RootProps> & {
		placeholder?: string;
		items: { value: string; label: string; disabled?: boolean }[];
		contentProps?: WithoutChildren<Select.ContentProps>;
		// any other specific component props if needed
	};

	let { value = $bindable(), items, contentProps, placeholder, ...restProps }: Props = $props();

	const selectedLabel = $derived(items.find((item) => item.value === value)?.label);
</script>

<!--
TypeScript Discriminated Unions + destructing (required for "bindable") do not
get along, so we shut typescript up by casting `value` to `never`, however,
from the perspective of the consumer of this component, it will be typed appropriately.
-->
<Select.Root bind:value={value as never} {...restProps}>
	<Select.Trigger
		class="flex w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm hover:border-gray-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
	>
		<span class="truncate">
			{#if selectedLabel}
				{selectedLabel}
			{:else}
				<span class="text-gray-500">{placeholder}</span>
			{/if}
		</span>
		<ChevronsUpDown class="ml-2 h-4 w-4 text-gray-500" />
	</Select.Trigger>
	<Select.Portal>
		<Select.Content
			class="z-50 max-h-[var(--bits-select-content-available-height)] w-[var(--bits-select-anchor-width)] min-w-[var(--bits-select-anchor-width)] overflow-hidden rounded-md border border-slate-300 bg-white shadow-lg"
			{...contentProps}
			sideOffset={8}
		>
			<Select.ScrollUpButton
				class="flex h-6 cursor-pointer items-center justify-center bg-white text-gray-500 hover:text-gray-800"
			>
				<ChevronsUp class="h-4 w-4" />
			</Select.ScrollUpButton>
			<Select.Viewport class="p-1">
				{#each items as { value, label, disabled } (value)}
					<Select.Item
						{value}
						{label}
						{disabled}
						class="relative flex w-full cursor-pointer items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-orange-100 data-[highlighted]:text-orange-900"
					>
						{#snippet children({ selected })}
							<span
								class="absolute right-2 flex h-3.5 w-3.5 items-center justify-center text-orange-600"
							>
								{#if selected}
									<Check class="h-4 w-4" />
								{/if}
							</span>
							<span class="truncate">{label}</span>
						{/snippet}
					</Select.Item>
				{/each}
			</Select.Viewport>
			<Select.ScrollDownButton
				class="flex h-6 cursor-pointer items-center justify-center bg-white text-gray-500 hover:text-gray-800"
			>
				<ChevronsDown class="h-4 w-4" />
			</Select.ScrollDownButton>
		</Select.Content>
	</Select.Portal>
</Select.Root>
