<script lang="ts">
	import { Button, RadioCard, RadioCardGroup, SettingRow, Switch, TextField } from '$lib/ui';
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

	const paper = $derived(paperById($pageSetupStore.paper));
	const margin = $derived(marginById($pageSetupStore.margin));

	/** The text column, which is the number that actually decides the layout. */
	const measureInches = $derived(
		(paper.widthPx / 96 - margin.inches * 2).toFixed(2).replace(/\.?0+$/, '')
	);

	const heads: { key: keyof RunningHeads; label: string; hint?: string }[] = [
		{ key: 'headerLeft', label: 'Header, left', hint: 'Often a running title' },
		{ key: 'headerRight', label: 'Header, right' },
		{ key: 'footerLeft', label: 'Footer, left' },
		{ key: 'footerRight', label: 'Footer, right', hint: 'Where a page number usually goes' }
	];

	const inches = (px: number) => (px / 96).toFixed(2).replace(/\.?0+$/, '');
</script>

<!-- Rows with a rule between them, like every Settings tab (M6-8). -->
<div class="grid">
	<SettingRow
		label="Paper size"
		hint="What the manuscript is laid out on, on screen and in the exported PDF."
		stacked
	>
		{#snippet children({ labelId, hintId })}
			<RadioCardGroup
				aria-labelledby={labelId}
				aria-describedby={hintId}
				columns={3}
				value={$pageSetupStore.paper}
				onValueChange={(paper) => set({ paper: paper as PaperId })}
			>
				{#each PAPERS as option (option.id)}
					<RadioCard
						value={option.id}
						label={option.label}
						description="{inches(option.widthPx)} × {inches(option.heightPx)} in"
					/>
				{/each}
			</RadioCardGroup>
		{/snippet}
	</SettingRow>

	<SettingRow
		label="Margins"
		hint="Journals ask for one inch, and it is what Word gives by default — a manuscript written here matches the one a co-author sends back."
		stacked
	>
		{#snippet children({ labelId, hintId })}
			<RadioCardGroup
				aria-labelledby={labelId}
				aria-describedby={hintId}
				columns={3}
				value={$pageSetupStore.margin}
				onValueChange={(margin) => set({ margin: margin as MarginId })}
			>
				{#each MARGINS as option (option.id)}
					<RadioCard value={option.id} label={option.label} description="{option.inches} in" />
				{/each}
			</RadioCardGroup>
			<p class="text-caption text-ink-muted">Text column: {measureInches} in wide.</p>
		{/snippet}
	</SettingRow>

	<SettingRow
		label="Line spacing"
		hint="Most journals require a double-spaced manuscript for review, so there is room to write between the lines. It is a submission requirement rather than a matter of taste."
		stacked
	>
		{#snippet children({ labelId, hintId })}
			<RadioCardGroup
				aria-labelledby={labelId}
				aria-describedby={hintId}
				columns={3}
				value={$pageSetupStore.spacing}
				onValueChange={(spacing) => set({ spacing: spacing as SpacingId })}
			>
				{#each SPACINGS as option (option.id)}
					<RadioCard value={option.id} label={option.label} description={option.hint} />
				{/each}
			</RadioCardGroup>
		{/snippet}
	</SettingRow>

	<div class="border-line grid gap-2 border-t py-3">
		<span class="grid gap-0.5">
			<span class="text-small text-ink font-medium">Header and footer</span>
			<span class="text-caption text-ink-muted">
				Repeated on every page. Write
				<code class="bg-surface-sunken rounded px-1 font-mono">{'{page}'}</code>
				for the page number and
				<code class="bg-surface-sunken rounded px-1 font-mono">{'{total}'}</code>
				for the count.
			</span>
		</span>

		<div class="grid grid-cols-2 gap-3">
			{#each heads as slot (slot.key)}
				<TextField
					label={slot.label}
					hint={slot.hint}
					value={$pageSetupStore.runningHeads[slot.key]}
					placeholder="Empty"
					oninput={(e) => setHead({ [slot.key]: e.currentTarget.value })}
				/>
			{/each}
		</div>
	</div>

	<!-- Both take effect at once, so Switches rather than the checkboxes they were. -->
	<div class="border-line grid gap-3 border-t py-3">
		<Switch
			label="Leave the first page bare"
			description="No header or footer on page one. A title page carries no page number in any style guide."
			checked={$pageSetupStore.firstPageBare}
			onCheckedChange={(firstPageBare) => set({ firstPageBare })}
		/>
		<Switch
			label="Show page breaks while writing"
			description="Off gives one continuous column, which is faster on a very long manuscript. The exported PDF is paginated either way."
			checked={$pageSetupStore.paginate}
			onCheckedChange={(paginate) => set({ paginate })}
		/>
	</div>

	<div class="border-line border-t pt-3">
		<Button variant="ghost" size="sm" onclick={() => void pageSetupStore.reset()}>
			Reset page setup to defaults
		</Button>
	</div>
</div>
