<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import Minus from '~icons/lucide/minus';
	import Plus from '~icons/lucide/plus';

	import Field, { controlClass } from './Field.svelte';

	/**
	 * A number in a range: a font size, the zoom, a word-count target (M5-8).
	 *
	 * Typed into, or stepped: the arrow keys by `step`, with Shift by `bigStep`,
	 * and the − and + beside it when `steppers` is on. A typed number counts on
	 * Enter or leaving the field, not as it's typed, so "12" isn't applied as "1"
	 * on the way. One that's out of range says so under the field and waits, and
	 * leaving it puts the last good number back.
	 *
	 * A text box with `role="spinbutton"` rather than `type="number"`: the
	 * browser's own takes a scroll wheel as a change, draws spinners no palette
	 * reaches, and quietly reads "1e3" as a thousand.
	 */
	interface Props extends Omit<
		HTMLInputAttributes,
		'type' | 'id' | 'value' | 'min' | 'max' | 'step' | 'onchange'
	> {
		label: string;
		hideLabel?: boolean;
		hint?: string;
		/** An error of the caller's own; a number out of range is said without one. */
		error?: string;
		value: number;
		min: number;
		max: number;
		step?: number;
		/** With Shift held, and Page Up and Page Down. */
		bigStep?: number;
		/** After the number, in the box: "px", "%". */
		unit?: string;
		/** − and + beside the number, for the mouse. The keyboard has the arrows. */
		steppers?: boolean;
		/** The steppers' names: "Smaller", "Larger". */
		stepLabels?: [string, string];
		/** What a number out of range is called in the error: "a size". */
		noun?: string;
		/** A number was chosen: typed and entered, or stepped. */
		onchange?: (value: number) => void;
		/** The error over what's below it, as in a toolbar (`Field`). */
		floatNote?: boolean;
	}

	let {
		label,
		hideLabel,
		hint,
		error,
		value = $bindable(),
		min,
		max,
		step = 1,
		bigStep = step * 10,
		unit,
		steppers = false,
		stepLabels = ['Less', 'More'],
		noun = 'a number',
		onchange,
		floatNote,
		disabled,
		class: extra,
		onkeydown,
		onblur,
		...rest
	}: Props = $props();

	/** What's being typed, until it's entered. */
	let draft: string | null = $state(null);

	// As many places as the step has, so 0.1 steps don't show 1.2000000000000002.
	const places = $derived((String(step).split('.')[1] ?? '').length);
	const tidy = (n: number) => Number(n.toFixed(places));
	const shown = $derived(draft ?? String(tidy(value)));

	function parse(text: string): number | null {
		let bare = text.trim();
		// "16px" and "16 px" are sixteen, as the box itself shows them.
		if (unit && bare.endsWith(unit)) bare = bare.slice(0, -unit.length).trim();
		return /^-?\d+(\.\d+)?$/.test(bare) ? Number(bare) : null;
	}

	const typed = $derived(draft === null ? null : parse(draft));
	const outOfRange = $derived(
		draft !== null && (typed === null || typed < min || typed > max)
			? `Enter ${noun} from ${min} to ${max}.`
			: undefined
	);

	function choose(n: number) {
		draft = null;
		const next = tidy(Math.min(max, Math.max(min, n)));
		if (next === value) return;
		value = next;
		onchange?.(next);
	}

	/** From what's in the box, if that's a number, so a step follows the typing. */
	function stepBy(by: number) {
		choose((typed ?? value) + by);
	}

	function enter() {
		if (draft === null || outOfRange || typed === null) return;
		choose(typed);
	}

	function keydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
		onkeydown?.(event);
		if (event.defaultPrevented) return;
		const big = event.shiftKey ? bigStep : step;
		const steps: Record<string, number> = {
			ArrowUp: big,
			ArrowDown: -big,
			PageUp: bigStep,
			PageDown: -bigStep
		};
		if (event.key in steps) {
			event.preventDefault();
			stepBy(steps[event.key]);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			enter();
		} else if (event.key === 'Escape' && draft !== null) {
			event.preventDefault();
			event.stopPropagation();
			draft = null;
		}
	}

	const stepper =
		'text-ink-muted enabled:hover:bg-surface-hover enabled:hover:text-ink grid size-5 place-items-center rounded disabled:opacity-50';
</script>

<Field {label} {hideLabel} {hint} {floatNote} error={error || outOfRange}>
	{#snippet control(field)}
		<div class={['relative', extra]}>
			<input
				type="text"
				inputmode="decimal"
				role="spinbutton"
				autocomplete="off"
				aria-valuenow={value}
				aria-valuemin={min}
				aria-valuemax={max}
				aria-valuetext={unit ? `${tidy(value)} ${unit}` : undefined}
				value={shown}
				{disabled}
				class={[
					controlClass,
					'h-(--row-height) pl-2 tabular-nums',
					steppers ? 'pr-14' : unit ? 'pr-7' : 'pr-2'
				]}
				oninput={(event) => (draft = event.currentTarget.value)}
				onkeydown={keydown}
				onblur={(event) => {
					onblur?.(event);
					// A good number counts; anything else gives the last one back.
					if (!outOfRange) enter();
					draft = null;
				}}
				{...rest}
				{...field}
			/>
			<span
				class="pointer-events-none absolute inset-y-0 flex items-center gap-0.5 {steppers
					? 'right-0.5'
					: 'right-2'}"
			>
				{#if unit}
					<span class="text-caption text-ink-muted mr-0.5">{unit}</span>
				{/if}
				{#if steppers}
					<!-- Out of the tab order and the toolbar's arrows: the box's own
					     arrow keys do the same. -->
					<button
						type="button"
						tabindex="-1"
						data-toolbar-skip
						class="pointer-events-auto {stepper}"
						aria-label={stepLabels[0]}
						disabled={disabled || value <= min}
						onclick={() => stepBy(-step)}
					>
						<Minus class="size-3" aria-hidden="true" />
					</button>
					<button
						type="button"
						tabindex="-1"
						data-toolbar-skip
						class="pointer-events-auto {stepper}"
						aria-label={stepLabels[1]}
						disabled={disabled || value >= max}
						onclick={() => stepBy(step)}
					>
						<Plus class="size-3" aria-hidden="true" />
					</button>
				{/if}
			</span>
		</div>
	{/snippet}
</Field>
