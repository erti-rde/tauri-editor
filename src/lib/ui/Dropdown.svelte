<script lang="ts">
	import type { Snippet } from 'svelte';
	import { DropdownMenu, type WithoutChild } from 'bits-ui';
	import ChevronDown from '~icons/lucide/chevron-down';

	type ItemType = {
		label: string;
		icon?: any; // Icon component or null
		isActive?: boolean;
		callBack: () => void;
	};

	type Props = DropdownMenu.Props & {
		buttonText: string | Snippet;
		activeItemLabel?: string;
		items: ItemType[];
		contentProps?: WithoutChild<DropdownMenu.Content.Props>;
	};

	let {
		open = $bindable(false),
		children,
		buttonText,
		items,
		contentProps,
		...restProps
	}: Props = $props();

	let activeItem = $derived.by<ItemType | null>(() => {
		return items.find((item: ItemType) => item.isActive) || null;
	});
</script>

<DropdownMenu.Root bind:open {...restProps}>
	<DropdownMenu.Trigger>
		<div
			class={['mr-1 flex h-full w-full items-center', activeItem && 'rounded-md bg-orange-200/70']}
		>
			{#if activeItem}
				<activeItem.icon class="ml-1 text-orange-600" />
			{:else}
				{@render buttonText()}
			{/if}
			<ChevronDown class="ml-1 h-3 w-3" />
		</div>
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content
			class="shadow-popover rounded-xl border border-slate-500 bg-white px-1 py-1.5 outline-hidden focus-visible:outline-hidden"
			{...contentProps}
		>
			<DropdownMenu.Group aria-label={buttonText}>
				{#each items as item}
					<DropdownMenu.Item
						onclick={() => {
							item.callBack();
							activeItem = item;
						}}
						class="flex h-10 items-center rounded-xs py-3 pr-1.5 pl-3 text-sm font-medium ring-0! ring-transparent! transition-colors hover:bg-orange-100 focus-visible:outline-none data-highlighted:bg-orange-100"
						textValue={item}
					>
						{#if item.icon}
							<div class="flex items-center">
								<item.icon class={['mr-2 h-6 w-6', item.isActive && 'text-orange-600']} />
								{item.label}
							</div>
						{:else}
							{item.label}
						{/if}
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Group>
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
