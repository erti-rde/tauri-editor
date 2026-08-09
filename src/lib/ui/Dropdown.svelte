<script lang="ts">
	import type { Snippet, SvelteComponent } from 'svelte';
	import type { SvelteHTMLElements } from 'svelte/elements';
	import { DropdownMenu, type WithoutChild } from 'bits-ui';
	import ChevronDown from '~icons/lucide/chevron-down';

	type ItemType = {
		label: string;
		// Matches the icon typing convention already used in ToolBar.svelte.
		icon?: typeof SvelteComponent<SvelteHTMLElements['svg']>;
		isActive?: boolean;
		callBack: () => void;
	};

	type Props = DropdownMenu.RootProps & {
		buttonText: Snippet;
		/** Accessible name for the menu group; buttonText is visual only. */
		ariaLabel: string;
		activeItemLabel?: string;
		items: ItemType[];
		contentProps?: WithoutChild<DropdownMenu.ContentProps>;
	};

	let {
		open = $bindable(false),
		children: _children,
		buttonText,
		ariaLabel,
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
			class={[
				'mr-1 flex h-full w-full items-center',
				activeItem && 'bg-accent-quiet/70 rounded-md'
			]}
		>
			{#if activeItem}
				<activeItem.icon class="text-accent ml-1" />
			{:else}
				{@render buttonText()}
			{/if}
			<ChevronDown class="ml-1 h-3 w-3" />
		</div>
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content
			class="shadow-popover bg-surface-raised border-line-strong rounded-xl border px-1 py-1.5 outline-hidden focus-visible:outline-hidden"
			{...contentProps}
		>
			<DropdownMenu.Group aria-label={ariaLabel}>
				{#each items as item (item.label)}
					<DropdownMenu.Item
						onclick={() => {
							item.callBack();
							activeItem = item;
						}}
						class="hover:bg-accent-quiet data-highlighted:bg-accent-quiet flex h-10 items-center rounded-xs py-3 pr-1.5 pl-3 text-sm font-medium ring-0! ring-transparent! transition-colors focus-visible:outline-none"
						textValue={item.label}
					>
						{#if item.icon}
							<div class="flex items-center">
								<item.icon class={['mr-2 h-6 w-6', item.isActive && 'text-accent']} />
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
