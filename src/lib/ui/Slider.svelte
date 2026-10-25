<script lang="ts">
	import { Slider } from 'bits-ui';

	/**
	 * A number chosen by feel, applied at once: the interface size, the
	 * manuscript's (M6-8). For a number that's typed, or waits for a Save, use
	 * `NumberField`.
	 *
	 * The value sits beside the label in tabular figures, so nobody has to guess
	 * it from where the thumb is, and it's read out with its unit ("13 px")
	 * rather than as a bare number. Arrow keys step by `step`, Page Up and Page
	 * Down by ten of them, and Home and End go to either end.
	 *
	 * On bits-ui's slider rather than `type="range"`, whose track and thumb are
	 * the platform's own: WebKit draws them in a blue no palette reaches.
	 */
	interface Props {
		label: string;
		/** One line under the track on what it changes. */
		hint?: string;
		value: number;
		min: number;
		max: number;
		step?: number;
		/** After the number: "px". */
		unit?: string;
		/** Marked under the track, with "default" beside it. */
		defaultValue?: number;
		disabled?: boolean;
		/** As it moves: what it sets takes effect at once, like a `Switch`. */
		onValueChange?: (value: number) => void;
	}

	let {
		label,
		hint,
		value = $bindable(),
		min,
		max,
		step = 1,
		unit,
		defaultValue,
		disabled = false,
		onValueChange
	}: Props = $props();

	const id = $props.id();
	const said = (n: number) => (unit ? `${n} ${unit}` : String(n));
	const at = (n: number) => `${((n - min) / (max - min)) * 100}%`;
</script>

<div class="grid gap-2">
	<div class="flex items-baseline justify-between gap-3">
		<span id="{id}-label" class="text-small text-ink font-medium">{label}</span>
		<span class="text-small text-ink tabular-nums" aria-hidden="true">{said(value)}</span>
	</div>

	<Slider.Root
		type="single"
		bind:value
		{min}
		{max}
		{step}
		{disabled}
		{onValueChange}
		class="relative flex h-4 w-full touch-none items-center select-none data-disabled:opacity-50"
	>
		<span class="bg-line-strong relative h-1 w-full grow overflow-hidden rounded-full">
			<Slider.Range class="bg-accent absolute h-full" />
		</span>
		<Slider.Thumb
			index={0}
			aria-labelledby="{id}-label"
			aria-describedby={hint ? `${id}-hint` : undefined}
			aria-valuetext={said(value)}
			class="border-accent bg-surface-raised ease-standard block size-3.5 cursor-grab rounded-full border-2 transition-colors duration-(--duration-fast) active:cursor-grabbing data-disabled:cursor-not-allowed"
		/>
	</Slider.Root>

	{#if defaultValue !== undefined}
		<!-- Placed with a style, not a class: where it sits is data. -->
		<div class="text-caption text-ink-muted relative h-4 tabular-nums" aria-hidden="true">
			<span class="absolute start-0">{min}</span>
			<span class="absolute -translate-x-1/2 whitespace-nowrap" style:left={at(defaultValue)}>
				{defaultValue} · default
			</span>
			<span class="absolute end-0">{max}</span>
		</div>
	{/if}

	{#if hint}
		<span id="{id}-hint" class="text-caption text-ink-muted">{hint}</span>
	{/if}
</div>
