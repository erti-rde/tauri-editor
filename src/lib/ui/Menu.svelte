<script lang="ts" module>
	import type { IconComponent } from './icon';

	export interface MenuItem {
		label: string;
		/** One line on what it does, when the label alone doesn't say. */
		description?: string;
		icon?: IconComponent;
		/** The current choice, such as the heading level the cursor is in. */
		active?: boolean;
		/** Destructive. Sits last, after a separator, whatever order it's given in. */
		danger?: boolean;
		disabled?: boolean;
		onSelect: () => void;
	}
</script>

<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import Check from '~icons/lucide/check';
	import ChevronDown from '~icons/lucide/chevron-down';

	import { buttonClass } from './Button.svelte';

	interface Props {
		/** The menu's name, read on its trigger and on the list it opens. */
		label: string;
		items: MenuItem[];
		/** What the trigger shows. The label, by default. */
		trigger?: Snippet;
		open?: boolean;
		align?: 'start' | 'center' | 'end';
		disabled?: boolean;
	}

	let {
		label,
		items,
		trigger,
		open = $bindable(false),
		align = 'start',
		disabled = false
	}: Props = $props();

	const safe = $derived(items.filter((item) => !item.danger));
	const dangerous = $derived(items.filter((item) => item.danger));
</script>

{#snippet row(item: MenuItem)}
	<DropdownMenu.Item
		disabled={item.disabled}
		aria-current={item.active || undefined}
		onSelect={item.onSelect}
		class={[
			'text-small flex cursor-default items-start gap-2 rounded-sm px-2 py-1.5 outline-hidden select-none',
			'data-highlighted:bg-surface-hover data-disabled:opacity-50',
			item.danger ? 'text-danger' : item.active ? 'text-accent' : 'text-ink'
		]}
	>
		{#if item.icon}
			<item.icon class="mt-px size-4 shrink-0" aria-hidden="true" />
		{/if}
		<span class="grid flex-1 gap-0.5">
			<span>{item.label}</span>
			{#if item.description}
				<span class="text-caption text-ink-muted">{item.description}</span>
			{/if}
		</span>
		{#if item.active}
			<Check class="mt-px size-3.5 shrink-0" aria-hidden="true" />
		{/if}
	</DropdownMenu.Item>
{/snippet}

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger
		aria-label={label}
		{disabled}
		class={buttonClass({ variant: 'ghost', size: 'md' }, 'px-1')}
	>
		{#if trigger}
			{@render trigger()}
		{:else}
			{label}
		{/if}
		<ChevronDown class="size-3" aria-hidden="true" />
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content
			{align}
			sideOffset={4}
			class="shadow-overlay bg-surface-raised border-line-strong z-50 grid min-w-48 rounded border p-1 outline-hidden"
		>
			<DropdownMenu.Group aria-label={label}>
				{#each safe as item (item.label)}
					{@render row(item)}
				{/each}
			</DropdownMenu.Group>
			{#if dangerous.length > 0}
				{#if safe.length > 0}
					<DropdownMenu.Separator class="bg-line my-1 h-px" />
				{/if}
				<DropdownMenu.Group>
					{#each dangerous as item (item.label)}
						{@render row(item)}
					{/each}
				</DropdownMenu.Group>
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
