<script lang="ts">
	import { onMount } from 'svelte';

	import Trash from '~icons/lucide/trash-2';

	import { Button, ColourField, IconButton, Switch, TextField } from '$lib/ui';
	import { annotationsStore } from '$lib/stores/annotations.svelte';
	import { followSetting, nudgeSetting } from '$lib/notes/writingSettings';
	import {
		deleteLabel,
		nameLabelsAfterColours,
		restoreDefaultLabels,
		saveLabel,
		type AnnotationLabel
	} from '$lib/stores/db';
	import { LABEL_COLOURS, defaultColourFor } from '$lib/stores/labelColours';
	import { errorToast, successToast } from '$lib/ui/Toast.svelte';

	/**
	 * The highlight labels, and what they mean.
	 *
	 * Erti ships eight because a blank palette is not a neutral starting point —
	 * most people never open a settings pane, and a reader left with eight
	 * unnamed colours ends up using one of them for everything. Six of the
	 * defaults describe what a passage *is*, and two describe what the reader
	 * makes of it.
	 *
	 * Every one of them is a suggestion. Renaming, recolouring, reordering and
	 * removing are all here, because how a researcher marks a paper is a habit
	 * they already have and this should fit around it rather than replace it.
	 */

	let saving: string | null = $state(null);

	// loadLabels reports its own failures and leaves the list alone, so there is
	// nothing to catch here: an unopened library means an empty pane, not an error.
	onMount(() => {
		void annotationsStore.loadLabels();
	});

	/**
	 * A local copy to edit, which follows the store when it reloads.
	 *
	 * Writable `$derived` rather than `$state` mirrored by an `$effect`: the
	 * fields below write straight into it while typing, and it still resets to
	 * the saved values whenever the store publishes again.
	 */
	let labels = $derived($annotationsStore.labels.map((label) => ({ ...label })));

	async function persist(label: AnnotationLabel) {
		saving = label.id;
		try {
			await saveLabel(label);
			await annotationsStore.loadLabels();
		} catch (failure) {
			errorToast(
				`Could not save that label: ${failure instanceof Error ? failure.message : String(failure)}`
			);
		} finally {
			saving = null;
		}
	}

	async function restore() {
		try {
			const added = await restoreDefaultLabels();
			await annotationsStore.loadLabels();

			successToast(
				added === 0
					? 'All of the default labels are already here.'
					: `Put back ${added} ${added === 1 ? 'label' : 'labels'}.`
			);
		} catch (failure) {
			errorToast(
				`Could not restore the labels: ${failure instanceof Error ? failure.message : String(failure)}`
			);
		}
	}

	/**
	 * Rename them all after the colours they are.
	 *
	 * Erti has an opinion about what a highlight means and it is only a
	 * suggestion. Plenty of researchers already know what their own yellow means
	 * and would rather the application did not tell them — so naming a colour
	 * after itself is offered as a real answer, not as giving up.
	 */
	async function useColourNames() {
		try {
			const renamed = await nameLabelsAfterColours();
			await annotationsStore.loadLabels();

			successToast(
				renamed === 0
					? 'They are already named after their colours.'
					: `Renamed ${renamed} ${renamed === 1 ? 'label' : 'labels'}.`
			);
		} catch (failure) {
			errorToast(
				`Could not rename the labels: ${failure instanceof Error ? failure.message : String(failure)}`
			);
		}
	}

	async function remove(label: AnnotationLabel) {
		try {
			await deleteLabel(label.id);
			await annotationsStore.loadLabels();
		} catch (failure) {
			errorToast(
				`Could not remove that label: ${failure instanceof Error ? failure.message : String(failure)}`
			);
		}
	}
</script>

<h4 class="text-ink mb-2 text-sm font-medium">While writing</h4>

<!--
	Both on unless turned off, and both take effect at once (M3-4). Neither ever
	interrupts: the panel only shows, and the mark only sits in the margin.
-->
<div class="mb-6 flex flex-col gap-3">
	<Switch
		label="Follow my writing"
		description="The Notes panel shows your notes and passages from your papers that are close to the paragraph you are writing."
		checked={$followSetting}
		onCheckedChange={(checked) => void followSetting.setEnabled(checked)}
	/>
	<Switch
		label="Margin nudge"
		description="A small mark appears in the margin beside a paragraph you have already made a note about and not cited. Clicking it opens your notes."
		checked={$nudgeSetting}
		onCheckedChange={(checked) => void nudgeSetting.setEnabled(checked)}
	/>
</div>

<h4 class="text-ink mb-2 text-sm font-medium">Labels</h4>

<p class="text-ink-muted mb-4 text-sm">
	Colours you can highlight with, and what each one means to you. Rename them, recolour them, or
	switch off the ones you do not use — a highlight always takes the label you used last, so the list
	only matters when you want to change it.
</p>

<ul class="flex flex-col gap-2">
	{#each labels as label, index (label.id)}
		<li class="border-line flex items-center gap-2 rounded border p-2">
			<!-- One of the eight checked colours, named, rather than any colour a
			     native picker offers (M6-8). -->
			<ColourField
				label="Colour for {label.name}"
				value={label.colour}
				swatches={LABEL_COLOURS}
				defaultValue={defaultColourFor(label.id)}
				disabled={saving === label.id}
				onchange={(colour) => {
					labels[index].colour = colour;
					void persist(labels[index]);
				}}
			/>

			<div class="grow">
				<TextField
					label="Name for this label"
					hideLabel
					value={label.name}
					onblur={(event) => {
						const name = event.currentTarget.value.trim();
						if (!name || name === label.name) return;
						labels[index].name = name;
						void persist(labels[index]);
					}}
				/>
			</div>

			<Switch
				label="Show"
				checked={label.enabled}
				onCheckedChange={(checked) => {
					labels[index].enabled = checked;
					void persist(labels[index]);
				}}
			/>

			<!-- Highlights filed under it are kept, without a label. -->
			<IconButton
				label="Remove the label {label.name}"
				icon={Trash}
				size="sm"
				disabled={saving === label.id}
				onclick={() => remove(label)}
			/>
		</li>
	{/each}
</ul>

<div class="mt-4 flex items-center justify-between gap-4">
	<p class="text-ink-muted text-xs">
		Removing a label keeps the highlights made with it. They simply stop having one, and can be
		filed again later.
	</p>

	<div class="flex shrink-0 items-center gap-2">
		<Button
			size="sm"
			onclick={() => void useColourNames()}
			title="Rename every label after the colour it is — Yellow, Red, Green, and so on"
		>
			Name them after their colours
		</Button>

		{#if labels.length < 8}
			<Button
				size="sm"
				onclick={() => void restore()}
				title="Put back any of the eight defaults that are missing, leaving your own edits alone"
			>
				Restore the defaults
			</Button>
		{/if}
	</div>
</div>
