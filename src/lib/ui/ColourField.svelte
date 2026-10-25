<script lang="ts">
	import { RadioGroup } from 'bits-ui';
	import Check from '~icons/lucide/check';

	import Button from './Button.svelte';
	import Popover from './Popover.svelte';

	/**
	 * One colour from a few: a highlight label's (M6-8).
	 *
	 * A set of named swatches rather than the platform's colour picker, which
	 * offers every colour there is, including ones that vanish on a palette or
	 * hide the words under a mark. The colour is said on the trigger in words
	 * and the chosen swatch carries a check, so neither is told by colour alone.
	 *
	 * A colour from before there were swatches is kept and offered as "Custom",
	 * rather than shown as one of the eight it isn't.
	 *
	 * Arrow keys move between swatches and apply as they go, as in every
	 * `RadioGroup`; a click or Enter also closes it.
	 */
	interface Swatch {
		/** HSL channels: "45 95% 62%". */
		value: string;
		name: string;
	}

	interface Props {
		/** What it colours: "Colour for Claim". */
		label: string;
		value: string;
		swatches: readonly Swatch[];
		/** What Reset puts back. Without one, there's no Reset. */
		defaultValue?: string;
		disabled?: boolean;
		onchange: (value: string) => void;
	}

	let { label, value, swatches, defaultValue, disabled = false, onchange }: Props = $props();

	let open = $state(false);

	const offered = $derived(
		swatches.some((swatch) => swatch.value === value)
			? swatches
			: [...swatches, { value, name: 'Custom' }]
	);
	const nameOf = (colour: string) => offered.find((swatch) => swatch.value === colour)?.name;
	const name = $derived(nameOf(value) ?? 'Custom');

	function choose(colour: string) {
		if (colour !== value) onchange(colour);
	}
</script>

<Popover label="{label}: {name}" bind:open {disabled} align="end">
	{#snippet trigger()}
		<!-- One width whatever the name, so the fields beside it line up. -->
		<span class="flex w-16 items-center gap-1.5 px-1">
			<span
				class="border-line-control size-3.5 shrink-0 rounded-full border"
				style:background="hsl({value})"
				aria-hidden="true"
			></span>
			<span class="text-ink">{name}</span>
		</span>
	{/snippet}

	<div class="grid w-52 gap-2.5">
		<RadioGroup.Root
			aria-label="Colour"
			{value}
			onValueChange={choose}
			class="grid grid-cols-4 justify-items-center gap-2.5"
		>
			{#each offered as swatch (swatch.value)}
				<RadioGroup.Item
					value={swatch.value}
					aria-label={swatch.name}
					title={swatch.name}
					class="border-line-control data-[state=checked]:ring-ink ring-offset-surface-raised grid size-7 place-items-center rounded-full border ring-offset-2 data-[state=checked]:ring-2"
					style="background: hsl({swatch.value})"
					onclick={() => (open = false)}
				>
					{#snippet children({ checked })}
						{#if checked}
							<!-- On its own ground, so it shows on any swatch in any palette. -->
							<span class="bg-surface-raised text-ink grid size-4 place-items-center rounded-full">
								<Check class="size-3" aria-hidden="true" />
							</span>
						{/if}
					{/snippet}
				</RadioGroup.Item>
			{/each}
		</RadioGroup.Root>

		<div class="border-line flex min-h-5 items-center justify-between gap-2 border-t pt-2">
			<span class="text-caption text-ink-muted">
				{name}{value === defaultValue ? ' · the default' : ''}
			</span>
			{#if defaultValue !== undefined && value !== defaultValue}
				<Button variant="ghost" size="sm" onclick={() => choose(defaultValue)}>
					Reset to {nameOf(defaultValue) ?? 'the default'}
				</Button>
			{/if}
		</div>
	</div>
</Popover>
