<script lang="ts">
	import { Label, Select, type WithoutChildren } from 'bits-ui';
	import Check from '~icons/lucide/check';
	import ChevronsUpDown from '~icons/lucide/chevrons-up-down';
	import ChevronsUp from '~icons/lucide/chevrons-up';
	import ChevronsDown from '~icons/lucide/chevrons-down';

	import { controlClass } from './Field.svelte';

	/** One of many. For a few, all in view, `RadioGroup`. */
	type Props = WithoutChildren<Select.RootProps> & {
		label: string;
		hideLabel?: boolean;
		placeholder?: string;
		items: { value: string; label: string; disabled?: boolean }[];
		contentProps?: WithoutChildren<Select.ContentProps>;
	};

	let {
		value = $bindable(),
		label,
		hideLabel = false,
		items,
		contentProps,
		placeholder,
		...restProps
	}: Props = $props();

	const id = $props.id();
	const selectedLabel = $derived(items.find((item) => item.value === value)?.label);
</script>

<div class="grid gap-1">
	<Label.Root id="{id}-label" class={hideLabel ? 'sr-only' : 'text-small text-ink font-medium'}>
		{label}
	</Label.Root>
	<!--
	TypeScript Discriminated Unions + destructing (required for "bindable") do not
	get along, so we shut typescript up by casting `value` to `never`, however,
	from the perspective of the consumer of this component, it will be typed appropriately.
	-->
	<Select.Root bind:value={value as never} {...restProps}>
		<Select.Trigger
			aria-labelledby="{id}-label"
			class={[controlClass, 'flex h-(--row-height) items-center justify-between px-2']}
		>
			<span class="truncate">
				{#if selectedLabel}
					{selectedLabel}
				{:else}
					<span class="text-ink-faint">{placeholder}</span>
				{/if}
			</span>
			<ChevronsUpDown class="text-ink-muted ml-2 size-3.5" aria-hidden="true" />
		</Select.Trigger>
		<Select.Portal>
			<Select.Content
				class="shadow-overlay border-line-strong bg-surface-raised z-50 max-h-(--bits-select-content-available-height) w-(--bits-select-anchor-width) min-w-(--bits-select-anchor-width) overflow-hidden rounded border"
				{...contentProps}
				sideOffset={4}
			>
				<Select.ScrollUpButton
					class="bg-surface-raised text-ink-muted hover:text-ink flex h-5 cursor-pointer items-center justify-center"
				>
					<ChevronsUp class="size-3.5" aria-hidden="true" />
				</Select.ScrollUpButton>
				<Select.Viewport class="p-1">
					{#each items as { value, label, disabled } (value)}
						<Select.Item
							{value}
							{label}
							{disabled}
							class="text-small text-ink data-highlighted:bg-surface-hover relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-7 pl-2 outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50"
						>
							{#snippet children({ selected })}
								<span class="truncate">{label}</span>
								{#if selected}
									<Check class="text-accent absolute right-2 size-3.5" aria-hidden="true" />
								{/if}
							{/snippet}
						</Select.Item>
					{/each}
				</Select.Viewport>
				<Select.ScrollDownButton
					class="bg-surface-raised text-ink-muted hover:text-ink flex h-5 cursor-pointer items-center justify-center"
				>
					<ChevronsDown class="size-3.5" aria-hidden="true" />
				</Select.ScrollDownButton>
			</Select.Content>
		</Select.Portal>
	</Select.Root>
</div>
