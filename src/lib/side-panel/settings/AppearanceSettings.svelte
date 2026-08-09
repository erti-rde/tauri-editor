<script lang="ts">
	import { appearanceStore } from '$lib/theme/appearanceStore';
	import {
		PAGE_SIZE_RANGE,
		UI_SIZE_RANGE,
		type Appearance,
		type Density,
		type ThemeChoice
	} from '$lib/theme/theme';

	/**
	 * How Erti looks, changed live.
	 *
	 * Every control applies immediately rather than on Save. Appearance is the
	 * one kind of setting where you cannot tell whether you want it until you are
	 * looking at it, and a preview pane would only be a worse version of the app
	 * itself.
	 */

	const themes: { value: ThemeChoice; label: string; hint: string }[] = [
		{ value: 'light', label: 'Light', hint: 'Always light' },
		{ value: 'dark', label: 'Dark', hint: 'Always dark' },
		{ value: 'system', label: 'System', hint: 'Follow this computer' }
	];

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
</script>

<div class="space-y-8">
	<section>
		<h3 class="text-ink mb-1 text-sm font-medium">Theme</h3>
		<p class="text-ink-muted mb-3 text-xs">
			The manuscript keeps a paper surface in both themes — long prose is harder to read inverted.
		</p>

		<div class="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
			{#each themes as option (option.value)}
				<button
					type="button"
					role="radio"
					aria-checked={$appearanceStore.theme === option.value}
					class="rounded border px-3 py-2 text-left transition-colors
						{$appearanceStore.theme === option.value
						? 'border-accent bg-accent-quiet'
						: 'border-line hover:border-line-strong'}"
					onclick={() => set({ theme: option.value })}
				>
					<span class="text-ink block text-xs font-medium">{option.label}</span>
					<span class="text-ink-muted block text-[11px]">{option.hint}</span>
				</button>
			{/each}
		</div>
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
