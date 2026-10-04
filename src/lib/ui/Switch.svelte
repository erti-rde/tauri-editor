<script lang="ts">
	import { Label, Switch } from 'bits-ui';

	/**
	 * On or off, taking effect at once. For a choice that waits for a Save,
	 * use `Checkbox`.
	 */
	interface Props {
		label: string;
		/** One line under the label on what turning it on does. */
		description?: string;
		checked?: boolean;
		disabled?: boolean;
		onCheckedChange?: (checked: boolean) => void;
	}

	let {
		label,
		description,
		checked = $bindable(false),
		disabled = false,
		onCheckedChange
	}: Props = $props();

	const id = $props.id();
</script>

<div class="flex items-start justify-between gap-3">
	<span class="grid gap-0.5">
		<Label.Root for={id} class="text-small text-ink">{label}</Label.Root>
		{#if description}
			<span id="{id}-description" class="text-caption text-ink-muted">{description}</span>
		{/if}
	</span>
	<Switch.Root
		{id}
		bind:checked
		{disabled}
		{onCheckedChange}
		aria-describedby={description ? `${id}-description` : undefined}
		class="bg-line-strong data-[state=checked]:bg-accent ease-standard relative mt-px inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-(--duration-fast) disabled:cursor-not-allowed disabled:opacity-50"
	>
		<Switch.Thumb
			class="bg-surface-raised ease-standard pointer-events-none block size-3 translate-x-0.5 rounded-full transition-transform duration-(--duration-fast) data-[state=checked]:translate-x-3.5"
		/>
	</Switch.Root>
</div>
