<script lang="ts">
	import { RadioGroup } from 'bits-ui';

	import { appearanceStore } from '$lib/theme/appearanceStore';
	import {
		PAGE_SIZE_RANGE,
		PALETTES,
		UI_SIZE_RANGE,
		paletteMode,
		type Appearance,
		type Density
	} from '$lib/theme/theme';

	/**
	 * How Erti looks, changed live.
	 *
	 * Every control applies immediately rather than on Save. Appearance is the
	 * one kind of setting where you cannot tell whether you want it until you are
	 * looking at it, and a preview pane would only be a worse version of the app
	 * itself.
	 */

	/**
	 * Swatches are drawn by applying the palette to a real element via
	 * `data-theme`, so each one shows the actual tokens rather than a
	 * hand-maintained copy of them that would drift the first time a value
	 * changed.
	 */

	const densities: { value: Density; label: string; hint: string }[] = [
		{ value: 'compact', label: 'Compact', hint: 'Tighter rows, more on screen' },
		{ value: 'comfortable', label: 'Comfortable', hint: 'Larger targets' }
	];

	const pageFonts: { value: Appearance['pageFont']; label: string; hint: string }[] = [
		{ value: 'serif', label: 'Serif', hint: 'What journals print' },
		{ value: 'sans', label: 'Sans', hint: 'Cleaner on screen' },
		{ value: 'mono', label: 'Mono', hint: 'Fixed width' }
	];

	const set = (patch: Partial<Appearance>) => void appearanceStore.update(patch);

	/**
	 * One card, three groups.
	 *
	 * These were `<button role="radio">` in a `role="radiogroup"` div with no
	 * `tabindex` and no key handling: a screen reader announced a radio group,
	 * and arrow keys did nothing. `RadioGroup` brings roving tabindex, arrow and
	 * Home/End navigation and the ARIA wiring, so the selected style keys off
	 * `data-state` — bits-ui's own attribute — rather than a re-derived boolean.
	 */
	const choice =
		'border-line hover:border-line-strong data-[state=checked]:border-accent ' +
		'data-[state=checked]:bg-accent-quiet ' +
		'flex items-center gap-2 rounded border px-2 py-2 text-left transition-colors';

	/**
	 * Which palette `System` is currently showing.
	 *
	 * Without this the option is indistinguishable from the palette it resolves
	 * to — picking Erti Light on a light machine changes nothing visible, which
	 * reads as a broken control rather than a correct one.
	 */
	let prefersDark = $state(false);
	$effect(() => {
		if (typeof window.matchMedia !== 'function') return;

		const query = window.matchMedia('(prefers-color-scheme: dark)');
		prefersDark = query.matches;

		const onChange = (e: MediaQueryListEvent) => (prefersDark = e.matches);
		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	});

	const systemPalette = $derived(
		PALETTES.find((p) => p.id === (prefersDark ? 'dark' : 'light'))?.label ?? ''
	);
</script>

<div class="space-y-8">
	<section>
		<h3 class="text-ink mb-1 text-sm font-medium">Theme</h3>
		<p class="text-ink-muted mb-3 text-xs">
			Follow the computer, or pick a palette. Catppuccin and Night Owl are the editor themes many
			researchers already read code in.
		</p>

		<RadioGroup.Root
			class="grid grid-cols-2 gap-2"
			aria-label="Theme"
			value={$appearanceStore.theme}
			onValueChange={(theme) => set({ theme: theme as Appearance['theme'] })}
		>
			<RadioGroup.Item value="system" class="{choice} col-span-2 gap-3 px-3">
				<span class="border-line-strong flex shrink-0 overflow-hidden rounded-sm border">
					<span class="h-5 w-3" data-theme="light" style="background: hsl(var(--surface))"></span>
					<span class="h-5 w-3" data-theme="dark" style="background: hsl(var(--surface))"></span>
				</span>
				<span>
					<span class="text-ink block text-xs font-medium">System</span>
					<span class="text-ink-muted block text-[11px]">
						Follow this computer — showing {systemPalette} now, and switching with it
					</span>
				</span>
			</RadioGroup.Item>

			{#each PALETTES as palette (palette.id)}
				<RadioGroup.Item value={palette.id} class={choice}>
					<!-- The swatch is the palette applied to real elements, so it cannot
					     drift from the tokens it is advertising. -->
					<span
						class="border-line-strong flex shrink-0 overflow-hidden rounded-sm border"
						data-theme={palette.id}
					>
						<span class="h-5 w-2.5" style="background: hsl(var(--surface))"></span>
						<span class="h-5 w-2.5" style="background: hsl(var(--surface-raised))"></span>
						<span class="h-5 w-2.5" style="background: hsl(var(--accent))"></span>
						<span class="h-5 w-2.5" style="background: hsl(var(--ink))"></span>
					</span>
					<span class="min-w-0">
						<span class="text-ink block truncate text-xs font-medium">{palette.label}</span>
						<span class="text-ink-muted block text-[11px]">{paletteMode(palette.id)}</span>
					</span>
				</RadioGroup.Item>
			{/each}
		</RadioGroup.Root>

		<label class="mt-3 flex items-start gap-2">
			<input
				type="checkbox"
				class="accent-accent mt-0.5"
				checked={$appearanceStore.paperPage}
				onchange={(e) => set({ paperPage: e.currentTarget.checked })}
			/>
			<span>
				<span class="text-ink block text-xs">Keep the manuscript on paper</span>
				<span class="text-ink-muted block text-[11px]">
					Long prose is harder to read inverted, and the page then matches the printed PDF. Turn
					this off to put the manuscript in the palette's own colours.
				</span>
			</span>
		</label>
	</section>

	<section>
		<h3 class="text-ink mb-1 text-sm font-medium">Density</h3>
		<p class="text-ink-muted mb-3 text-xs">How much fits on screen at once.</p>

		<RadioGroup.Root
			class="grid grid-cols-2 gap-2"
			aria-label="Density"
			value={$appearanceStore.density}
			onValueChange={(density) => set({ density: density as Density })}
		>
			{#each densities as option (option.value)}
				<RadioGroup.Item value={option.value} class="{choice} block px-3">
					<span class="text-ink block text-xs font-medium">{option.label}</span>
					<span class="text-ink-muted block text-[11px]">{option.hint}</span>
				</RadioGroup.Item>
			{/each}
		</RadioGroup.Root>
	</section>

	<section>
		<h3 class="text-ink mb-3 text-sm font-medium">Text size</h3>

		<label class="mb-4 block">
			<span class="mb-1 flex items-baseline justify-between">
				<span class="text-ink text-xs">Interface</span>
				<span class="text-ink-muted font-mono text-[11px]">{$appearanceStore.uiSize}px</span>
			</span>
			<input
				type="range"
				class="accent-accent w-full"
				min={UI_SIZE_RANGE.min}
				max={UI_SIZE_RANGE.max}
				value={$appearanceStore.uiSize}
				oninput={(e) => set({ uiSize: Number(e.currentTarget.value) })}
			/>
		</label>

		<label class="block">
			<span class="mb-1 flex items-baseline justify-between">
				<span class="text-ink text-xs">Manuscript</span>
				<span class="text-ink-muted font-mono text-[11px]">{$appearanceStore.pageSize}px</span>
			</span>
			<input
				type="range"
				class="accent-accent w-full"
				min={PAGE_SIZE_RANGE.min}
				max={PAGE_SIZE_RANGE.max}
				value={$appearanceStore.pageSize}
				oninput={(e) => set({ pageSize: Number(e.currentTarget.value) })}
			/>
			<span class="text-ink-muted mt-1 block text-[11px]">
				Only what you see while writing. The exported PDF is unaffected.
			</span>
		</label>
	</section>

	<section>
		<h3 class="text-ink mb-3 text-sm font-medium">Manuscript typeface</h3>

		<RadioGroup.Root
			class="grid grid-cols-3 gap-2"
			aria-label="Manuscript typeface"
			value={$appearanceStore.pageFont}
			onValueChange={(pageFont) => set({ pageFont: pageFont as Appearance['pageFont'] })}
		>
			{#each pageFonts as option (option.value)}
				<RadioGroup.Item value={option.value ?? 'serif'} class="{choice} block px-3">
					<span
						class="text-ink block text-xs font-medium"
						style="font-family: {option.value === 'serif'
							? 'Georgia, serif'
							: option.value === 'mono'
								? 'monospace'
								: 'sans-serif'}"
					>
						{option.label}
					</span>
					<span class="text-ink-muted block text-[11px]">{option.hint}</span>
				</RadioGroup.Item>
			{/each}
		</RadioGroup.Root>
	</section>

	<section class="border-line border-t pt-4">
		<button
			type="button"
			class="text-ink-muted hover:text-ink text-xs underline underline-offset-2"
			onclick={() => void appearanceStore.reset()}
		>
			Reset appearance to defaults
		</button>
	</section>
</div>
