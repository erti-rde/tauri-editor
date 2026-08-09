<script lang="ts">
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

		<div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Theme">
			<button
				type="button"
				role="radio"
				aria-checked={$appearanceStore.theme === 'system'}
				class="col-span-2 flex items-center gap-3 rounded border px-3 py-2 text-left transition-colors
					{$appearanceStore.theme === 'system'
					? 'border-accent bg-accent-quiet'
					: 'border-line hover:border-line-strong'}"
				onclick={() => set({ theme: 'system' })}
			>
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
			</button>

			{#each PALETTES as palette (palette.id)}
				<button
					type="button"
					role="radio"
					aria-checked={$appearanceStore.theme === palette.id}
					class="flex items-center gap-2 rounded border px-2 py-2 text-left transition-colors
						{$appearanceStore.theme === palette.id
						? 'border-accent bg-accent-quiet'
						: 'border-line hover:border-line-strong'}"
					onclick={() => set({ theme: palette.id })}
				>
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
				</button>
			{/each}
		</div>

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

		<div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Density">
			{#each densities as option (option.value)}
				<button
					type="button"
					role="radio"
					aria-checked={$appearanceStore.density === option.value}
					class="rounded border px-3 py-2 text-left transition-colors
						{$appearanceStore.density === option.value
						? 'border-accent bg-accent-quiet'
						: 'border-line hover:border-line-strong'}"
					onclick={() => set({ density: option.value })}
				>
					<span class="text-ink block text-xs font-medium">{option.label}</span>
					<span class="text-ink-muted block text-[11px]">{option.hint}</span>
				</button>
			{/each}
		</div>
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

		<div class="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Manuscript typeface">
			{#each pageFonts as option (option.value)}
				<button
					type="button"
					role="radio"
					aria-checked={$appearanceStore.pageFont === option.value}
					class="rounded border px-3 py-2 text-left transition-colors
						{$appearanceStore.pageFont === option.value
						? 'border-accent bg-accent-quiet'
						: 'border-line hover:border-line-strong'}"
					onclick={() => set({ pageFont: option.value })}
				>
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
				</button>
			{/each}
		</div>
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
