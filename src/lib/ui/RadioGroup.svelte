<script lang="ts">
	import { Label, RadioGroup } from 'bits-ui';

	/** One of a few, all in view. Arrow keys move between them. */
	interface Props {
		/** The question the options answer, read as the group's name. */
		label: string;
		hideLabel?: boolean;
		options: { value: string; label: string; description?: string; disabled?: boolean }[];
		value?: string;
		disabled?: boolean;
		orientation?: 'vertical' | 'horizontal';
		onValueChange?: (value: string) => void;
	}

	let {
		label,
		hideLabel = false,
		options,
		value = $bindable(''),
		disabled = false,
		orientation = 'vertical',
		onValueChange
	}: Props = $props();

	const id = $props.id();
</script>

<div class="grid gap-1.5">
	<span id="{id}-label" class={hideLabel ? 'sr-only' : 'text-small text-ink font-medium'}>
		{label}
	</span>
	<RadioGroup.Root
		bind:value
		{disabled}
		{orientation}
		{onValueChange}
		aria-labelledby="{id}-label"
		class={['flex gap-1.5', orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap gap-3']}
	>
		<!-- Ids by position: a value may hold a space, which would split an id
		     list such as aria-describedby in two. -->
		{#each options as option, i (option.value)}
			<div class="flex items-start gap-2">
				<RadioGroup.Item
					id="{id}-{i}"
					value={option.value}
					disabled={option.disabled}
					aria-describedby={option.description ? `${id}-${i}-description` : undefined}
					class="border-line-strong bg-surface-raised data-[state=checked]:border-accent mt-px grid size-3.5 shrink-0 place-items-center rounded-full border disabled:cursor-not-allowed disabled:opacity-50"
				>
					{#snippet children({ checked })}
						{#if checked}
							<span class="bg-accent size-1.5 rounded-full"></span>
						{/if}
					{/snippet}
				</RadioGroup.Item>
				<span class="grid gap-0.5">
					<Label.Root for="{id}-{i}" class="text-small text-ink">
						{option.label}
					</Label.Root>
					{#if option.description}
						<span id="{id}-{i}-description" class="text-caption text-ink-muted">
							{option.description}
						</span>
					{/if}
				</span>
			</div>
		{/each}
	</RadioGroup.Root>
</div>
