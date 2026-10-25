<script lang="ts">
	import { Button, RadioCard, RadioCardGroup, SettingRow, Slider, Switch } from '$lib/ui';
	import { appearanceStore } from '$lib/theme/appearanceStore';
	import {
		DEFAULT_APPEARANCE,
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

	// Each shown in its own face, so the choice is seen as well as named.
	const pageFonts: { value: Appearance['pageFont']; label: string; hint: string; face: string }[] =
		[
			{ value: 'serif', label: 'Serif', hint: 'What journals print', face: 'Georgia, serif' },
			{ value: 'sans', label: 'Sans', hint: 'Cleaner on screen', face: 'sans-serif' },
			{ value: 'mono', label: 'Mono', hint: 'Fixed width', face: 'monospace' }
		];

	const set = (patch: Partial<Appearance>) => void appearanceStore.update(patch);

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

<!--
	Rows with a rule between them, like every Settings tab (M6-8). The theme,
	density and typeface were `RadioGroup.Item`s with a hand-set "choice" class
	and captions at text-[11px]; they're `RadioCard`s now, which say the chosen
	one with a check as well as the accent edge.
-->
<div class="grid">
	<SettingRow
		label="Theme"
		hint="Follow the computer, or pick a palette. Catppuccin and Night Owl are the editor themes many researchers already read code in."
		stacked
	>
		{#snippet children({ labelId, hintId })}
			<RadioCardGroup
				aria-labelledby={labelId}
				aria-describedby={hintId}
				value={$appearanceStore.theme}
				onValueChange={(theme) => set({ theme: theme as Appearance['theme'] })}
			>
				<RadioCard
					value="system"
					label="System"
					description="Follow this computer — showing {systemPalette} now, and switching with it"
					class="col-span-2"
				>
					{#snippet leading()}
						<span class="border-line-strong flex shrink-0 overflow-hidden rounded border">
							<span class="h-5 w-3" data-theme="light" style="background: hsl(var(--surface))"
							></span>
							<span class="h-5 w-3" data-theme="dark" style="background: hsl(var(--surface))"
							></span>
						</span>
					{/snippet}
				</RadioCard>

				{#each PALETTES as palette (palette.id)}
					<RadioCard value={palette.id} label={palette.label} description={paletteMode(palette.id)}>
						{#snippet leading()}
							<!-- The swatch is the palette applied to real elements, so it
							     cannot drift from the tokens it is advertising. -->
							<span
								class="border-line-strong flex shrink-0 overflow-hidden rounded border"
								data-theme={palette.id}
							>
								<span class="h-5 w-2.5" style="background: hsl(var(--surface))"></span>
								<span class="h-5 w-2.5" style="background: hsl(var(--surface-raised))"></span>
								<span class="h-5 w-2.5" style="background: hsl(var(--accent))"></span>
								<span class="h-5 w-2.5" style="background: hsl(var(--ink))"></span>
							</span>
						{/snippet}
					</RadioCard>
				{/each}
			</RadioCardGroup>
		{/snippet}
	</SettingRow>

	<!-- It takes effect at once, so a Switch rather than the checkbox it was. -->
	<div class="border-line border-t py-3">
		<Switch
			label="Keep the manuscript on paper"
			description="Long prose is harder to read inverted, and the page then matches the printed PDF. Turn this off to put the manuscript in the palette's own colours."
			checked={$appearanceStore.paperPage}
			onCheckedChange={(paperPage) => set({ paperPage })}
		/>
	</div>

	<SettingRow label="Density" hint="How much fits on screen at once." stacked>
		{#snippet children({ labelId, hintId })}
			<RadioCardGroup
				aria-labelledby={labelId}
				aria-describedby={hintId}
				value={$appearanceStore.density}
				onValueChange={(density) => set({ density: density as Density })}
			>
				{#each densities as option (option.value)}
					<RadioCard value={option.value} label={option.label} description={option.hint} />
				{/each}
			</RadioCardGroup>
		{/snippet}
	</SettingRow>

	<div class="border-line grid gap-4 border-t py-3">
		<Slider
			label="Interface size"
			unit="px"
			min={UI_SIZE_RANGE.min}
			max={UI_SIZE_RANGE.max}
			defaultValue={DEFAULT_APPEARANCE.uiSize}
			value={$appearanceStore.uiSize}
			onValueChange={(uiSize) => set({ uiSize })}
		/>
		<Slider
			label="Manuscript size"
			unit="px"
			hint="Only what you see while writing. The exported PDF is unaffected."
			min={PAGE_SIZE_RANGE.min}
			max={PAGE_SIZE_RANGE.max}
			defaultValue={DEFAULT_APPEARANCE.pageSize}
			value={$appearanceStore.pageSize}
			onValueChange={(pageSize) => set({ pageSize })}
		/>
	</div>

	<SettingRow label="Manuscript typeface" stacked>
		{#snippet children({ labelId })}
			<RadioCardGroup
				aria-labelledby={labelId}
				columns={3}
				value={$appearanceStore.pageFont}
				onValueChange={(pageFont) => set({ pageFont: pageFont as Appearance['pageFont'] })}
			>
				{#each pageFonts as option (option.value)}
					<RadioCard value={option.value ?? 'serif'} label={option.label} description={option.hint}>
						{#snippet leading()}
							<span
								class="text-title text-ink shrink-0"
								style:font-family={option.face}
								aria-hidden="true">Aa</span
							>
						{/snippet}
					</RadioCard>
				{/each}
			</RadioCardGroup>
		{/snippet}
	</SettingRow>

	<div class="border-line border-t pt-3">
		<Button variant="ghost" size="sm" onclick={() => void appearanceStore.reset()}>
			Reset appearance to defaults
		</Button>
	</div>
</div>
