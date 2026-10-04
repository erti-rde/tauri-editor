<script lang="ts">
	/**
	 * Work with a known count: "Embedding notes · 214 of 380". For work whose
	 * end isn't known, `Loader`.
	 */
	interface Props {
		/** What's under way: "Embedding notes". */
		label: string;
		value: number;
		max: number;
		/** The unit, if "of 380" alone isn't clear: "papers". */
		unit?: string;
	}

	let { label, value, max, unit }: Props = $props();

	const done = $derived(Math.min(Math.max(value, 0), max));
	const share = $derived(max > 0 ? done / max : 0);
	const count = $derived(`${done} of ${max}${unit ? ` ${unit}` : ''}`);
</script>

<div class="grid gap-1">
	<div class="text-caption text-ink-muted flex justify-between gap-2">
		<span>{label}</span>
		<span class="tabular-nums">{count}</span>
	</div>
	<div
		role="progressbar"
		aria-label={label}
		aria-valuemin={0}
		aria-valuemax={max}
		aria-valuenow={done}
		aria-valuetext={count}
		class="bg-line h-0.5 overflow-hidden rounded-full"
	>
		<div
			class="bg-accent ease-standard h-full origin-left transition-transform duration-(--duration)"
			style:transform="scaleX({share})"
		></div>
	</div>
</div>
