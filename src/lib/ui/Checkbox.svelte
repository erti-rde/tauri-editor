<script lang="ts">
	import { Checkbox, Label } from 'bits-ui';
	import Check from '~icons/lucide/check';
	import Minus from '~icons/lucide/minus';

	/** One of a set of choices submitted together. For on/off at once, `Switch`. */
	interface Props {
		label: string;
		description?: string;
		checked?: boolean;
		/** Some of a group, for a "select all" box. */
		indeterminate?: boolean;
		disabled?: boolean;
		onCheckedChange?: (checked: boolean) => void;
	}

	let {
		label,
		description,
		checked = $bindable(false),
		indeterminate = $bindable(false),
		disabled = false,
		onCheckedChange
	}: Props = $props();

	const id = $props.id();
</script>

<div class="flex items-start gap-2">
	<Checkbox.Root
		{id}
		bind:checked
		bind:indeterminate
		{disabled}
		{onCheckedChange}
		aria-describedby={description ? `${id}-description` : undefined}
		class="border-line-control bg-surface-raised data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:border-accent text-accent-ink mt-px grid size-3.5 shrink-0 place-items-center rounded-sm border disabled:cursor-not-allowed disabled:opacity-50"
	>
		{#snippet children({ checked, indeterminate })}
			{#if indeterminate}
				<Minus class="size-3" aria-hidden="true" />
			{:else if checked}
				<Check class="size-3" aria-hidden="true" />
			{/if}
		{/snippet}
	</Checkbox.Root>
	<span class="grid gap-0.5">
		<Label.Root for={id} class="text-small text-ink">{label}</Label.Root>
		{#if description}
			<span id="{id}-description" class="text-caption text-ink-muted">{description}</span>
		{/if}
	</span>
</div>
