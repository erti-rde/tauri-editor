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
		/** Starts a group: a line above it, such as between a check and what it checks. */
		separated?: boolean;
		/**
		 * Something has changed that this is about, such as the document since its
		 * last check. A dot, so the description has to say what changed in words.
		 */
		dot?: boolean;
		onSelect: () => void;
	}
</script>

<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import Check from '~icons/lucide/check';
	import ChevronDown from '~icons/lucide/chevron-down';

	import { buttonClass } from './Button.svelte';
	import IconButton from './IconButton.svelte';

	interface Props {
		/** The menu's name, read on its trigger and on the list it opens. */
		label: string;
		items: MenuItem[];
		/** What the trigger shows. The label, by default. */
		trigger?: Snippet;
		open?: boolean;
		align?: 'start' | 'center' | 'end';
		disabled?: boolean;
		/**
		 * The trigger is this icon alone, as a small `IconButton`: the label is its
		 * tooltip and its name. For a menu that sits on something else, such as ⋯
		 * on a document's tab.
		 */
		icon?: IconComponent;
	}

	let {
		label,
		items,
		trigger,
		open = $bindable(false),
		align = 'start',
		disabled = false,
		icon
	}: Props = $props();

	const safe = $derived(items.filter((item) => !item.danger));
	// The current choice is said in words on the trigger, not only shown by an
	// icon's colour: "List style: Bullet list".
	const current = $derived(items.find((item) => item.active));
	const dangerous = $derived(items.filter((item) => item.danger));
</script>

{#snippet row(item: MenuItem)}
	<DropdownMenu.Item
		disabled={item.disabled}
		aria-current={item.active || undefined}
		onSelect={item.onSelect}
		class={[
			'text-small flex cursor-default items-start gap-2 rounded-sm px-2 py-1.5 outline-hidden select-none',
			// The words stay in ink: red or orange text on a highlighted row fell
			// below 4.5:1 in the darker palettes (M1c-5). The icon carries the
			// colour, where 3:1 is enough, and the words carry the meaning.
			'text-ink data-highlighted:bg-surface-hover data-disabled:opacity-50'
		]}
	>
		{#if item.icon}
			<item.icon
				class={['mt-px size-4 shrink-0', item.danger ? 'text-danger' : 'text-ink-muted']}
				aria-hidden="true"
			/>
		{/if}
		<span class="grid flex-1 gap-0.5">
			<span>{item.label}</span>
			{#if item.description}
				<span class="text-caption text-ink-muted">{item.description}</span>
			{/if}
		</span>
		{#if item.dot}
			<span class="bg-accent mt-1.5 size-1.5 shrink-0 rounded-full" aria-hidden="true"></span>
		{/if}
		{#if item.active}
			<Check class="text-accent mt-px size-3.5 shrink-0" aria-hidden="true" />
		{/if}
	</DropdownMenu.Item>
{/snippet}

<DropdownMenu.Root bind:open>
	{#if icon}
		<DropdownMenu.Trigger {disabled}>
			{#snippet child({ props })}
				<IconButton {...props} {label} {icon} size="sm" />
			{/snippet}
		</DropdownMenu.Trigger>
	{:else}
		<DropdownMenu.Trigger
			aria-label={current ? `${label}: ${current.label}` : label}
			{disabled}
			data-current={current ? '' : undefined}
			class={[
				buttonClass({ variant: 'ghost', size: 'tight' }),
				'data-current:bg-surface-active data-current:text-ink'
			]}
		>
			{#if trigger}
				{@render trigger()}
			{:else}
				{label}
			{/if}
			<ChevronDown class="size-3" aria-hidden="true" />
		</DropdownMenu.Trigger>
	{/if}
	<DropdownMenu.Portal>
		<DropdownMenu.Content
			{align}
			sideOffset={4}
			class="shadow-overlay bg-surface-raised border-line-strong z-50 grid min-w-48 rounded border p-1 outline-hidden"
		>
			<DropdownMenu.Group aria-label={label}>
				{#each safe as item, i (item.label)}
					{#if item.separated && i > 0}
						<DropdownMenu.Separator class="bg-line my-1 h-px" />
					{/if}
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
