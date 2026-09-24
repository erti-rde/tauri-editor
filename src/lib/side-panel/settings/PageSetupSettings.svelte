<script lang="ts">
	import { RadioGroup } from 'bits-ui';

	import {
		MARGINS,
		PAPERS,
		SPACINGS,
		marginById,
		pageSetupStore,
		paperById,
		type MarginId,
		type PaperId,
		type RunningHeads,
		type SpacingId
	} from '$lib/editor/pagination';

	/**
	 * The page, as a printer would describe it.
	 *
	 * Applied live rather than on Save, because none of these can be judged in
	 * the abstract — a 1.5in margin is a number until the text column narrows in
	 * front of you, and a running head is a guess until you see it on a page.
	 */

	const set = (patch: Parameters<typeof pageSetupStore.update>[0]) =>
		void pageSetupStore.update(patch);

	const setHead = (patch: Partial<RunningHeads>) =>
		set({ runningHeads: { ...$pageSetupStore.runningHeads, ...patch } });

	const choice =
		'border-line hover:border-line-strong data-[state=checked]:border-accent ' +
		'data-[state=checked]:bg-accent-quiet ' +
		'block rounded border px-3 py-2 text-left transition-colors';

	const paper = $derived(paperById($pageSetupStore.paper));
	const margin = $derived(marginById($pageSetupStore.margin));

	/** The text column, which is the number that actually decides the layout. */
	const measureInches = $derived(
		(paper.widthPx / 96 - margin.inches * 2).toFixed(2).replace(/\.?0+$/, '')
	);

	const heads: { key: keyof RunningHeads; label: string; hint: string }[] = [
		{ key: 'headerLeft', label: 'Header, left', hint: 'Often a running title' },
		{ key: 'headerRight', label: 'Header, right', hint: '' },
		{ key: 'footerLeft', label: 'Footer, left', hint: '' },
		{ key: 'footerRight', label: 'Footer, right', hint: 'Where a page number usually goes' }
	];
</script>

<div class="space-y-8">
	<section>
		<h3 class="text-ink mb-1 text-sm font-medium">Paper</h3>
		<p class="text-ink-muted mb-3 text-xs">
			What the manuscript is laid out on, on screen and in the exported PDF.
		</p>

		<RadioGroup.Root
			class="grid grid-cols-3 gap-2"
			aria-label="Paper size"
			value={$pageSetupStore.paper}
			onValueChange={(paper) => set({ paper: paper as PaperId })}
		>
			{#each PAPERS as option (option.id)}
				<RadioGroup.Item value={option.id} class={choice}>
					<span class="text-ink block text-xs font-medium">{option.label}</span>
					<span class="text-ink-muted block text-[11px]">
						{(option.widthPx / 96).toFixed(2).replace(/\.?0+$/, '')} × {(option.heightPx / 96)
							.toFixed(2)
							.replace(/\.?0+$/, '')} in
					</span>
				</RadioGroup.Item>
			{/each}
		</RadioGroup.Root>
	</section>

	<section>
		<h3 class="text-ink mb-1 text-sm font-medium">Margins</h3>
		<p class="text-ink-muted mb-3 text-xs">
			Journals ask for one inch, and it is what Word gives by default — a manuscript written here
			matches the one a co-author sends back.
		</p>

		<RadioGroup.Root
			class="grid grid-cols-3 gap-2"
			aria-label="Margins"
			value={$pageSetupStore.margin}
			onValueChange={(margin) => set({ margin: margin as MarginId })}
		>
			{#each MARGINS as option (option.id)}
				<RadioGroup.Item value={option.id} class={choice}>
					<span class="text-ink block text-xs font-medium">{option.label}</span>
					<span class="text-ink-muted block text-[11px]">{option.inches} in</span>
				</RadioGroup.Item>
			{/each}
		</RadioGroup.Root>

		<p class="text-ink-muted mt-2 text-[11px]">
			Text column: {measureInches} in wide.
		</p>
	</section>

	<section>
		<h3 class="text-ink mb-1 text-sm font-medium">Line spacing</h3>
		<p class="text-ink-muted mb-3 text-xs">
			Most journals require a double-spaced manuscript for review, so there is room to write between
			the lines. It is a submission requirement rather than a matter of taste.
		</p>

		<RadioGroup.Root
			class="grid grid-cols-3 gap-2"
			aria-label="Line spacing"
			value={$pageSetupStore.spacing}
			onValueChange={(spacing) => set({ spacing: spacing as SpacingId })}
		>
			{#each SPACINGS as option (option.id)}
				<RadioGroup.Item value={option.id} class="{choice} block px-3">
					<span class="text-ink block text-xs font-medium">{option.label}</span>
					<span class="text-ink-muted block text-[11px]">{option.hint}</span>
				</RadioGroup.Item>
			{/each}
		</RadioGroup.Root>
	</section>

	<section>
		<h3 class="text-ink mb-1 text-sm font-medium">Header and footer</h3>
		<p class="text-ink-muted mb-3 text-xs">
			Repeated on every page. Write
			<code class="bg-surface-sunken rounded px-1 font-mono">{'{page}'}</code>
			for the page number and
			<code class="bg-surface-sunken rounded px-1 font-mono">{'{total}'}</code>
			for the count.
		</p>

		<div class="grid grid-cols-2 gap-3">
			{#each heads as slot (slot.key)}
				<label class="block">
					<span class="text-ink mb-1 block text-xs">{slot.label}</span>
					<input
						type="text"
						class="border-line-strong bg-surface-raised text-ink w-full rounded border px-2 py-1 text-xs"
						value={$pageSetupStore.runningHeads[slot.key]}
						placeholder="Empty"
						oninput={(e) => setHead({ [slot.key]: e.currentTarget.value })}
					/>
					{#if slot.hint}
						<span class="text-ink-muted mt-1 block text-[11px]">{slot.hint}</span>
					{/if}
				</label>
			{/each}
		</div>
	</section>

	<section>
		<label class="mb-3 flex items-start gap-2">
			<input
				type="checkbox"
				class="accent-accent mt-0.5"
				checked={$pageSetupStore.firstPageBare}
				onchange={(e) => set({ firstPageBare: e.currentTarget.checked })}
			/>
			<span>
				<span class="text-ink block text-xs">Leave the first page bare</span>
				<span class="text-ink-muted block text-[11px]">
					No header or footer on page one. A title page carries no page number in any style guide.
				</span>
			</span>
		</label>

		<label class="flex items-start gap-2">
			<input
				type="checkbox"
				class="accent-accent mt-0.5"
				checked={$pageSetupStore.paginate}
				onchange={(e) => set({ paginate: e.currentTarget.checked })}
			/>
			<span>
				<span class="text-ink block text-xs">Show page breaks while writing</span>
				<span class="text-ink-muted block text-[11px]">
					Off gives one continuous column, which is faster on a very long manuscript. The exported
					PDF is paginated either way.
				</span>
			</span>
		</label>
	</section>

	<section class="border-line border-t pt-4">
		<button
			type="button"
			class="text-ink-muted hover:text-ink text-xs underline underline-offset-2"
			onclick={() => void pageSetupStore.reset()}
		>
			Reset page setup to defaults
		</button>
	</section>
</div>
