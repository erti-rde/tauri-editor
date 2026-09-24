<script lang="ts">
	import { onMount } from 'svelte';

	import Icon from '$lib/icon/Icon.svelte';
	import { annotationsStore } from '$lib/stores/annotations.svelte';
	import { nudgeSetting } from '$lib/notes/nudgeSetting';
	import {
		deleteLabel,
		nameLabelsAfterColours,
		restoreDefaultLabels,
		saveLabel,
		type AnnotationLabel
	} from '$lib/stores/db';
	import { errorToast, successToast } from '$lib/toast/Toast.svelte';

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
		void nudgeSetting.load();
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

	/**
	 * A colour picker speaks hex; the theme speaks `H S% L%` so a label sits in
	 * the same system as every other colour in the interface and can be written
	 * straight into a CSS variable.
	 */
	function hexToHsl(hex: string): string {
		const value = hex.replace('#', '');
		const r = parseInt(value.slice(0, 2), 16) / 255;
		const g = parseInt(value.slice(2, 4), 16) / 255;
		const b = parseInt(value.slice(4, 6), 16) / 255;

		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const l = (max + min) / 2;
		const d = max - min;

		if (d === 0) return `0 0% ${Math.round(l * 100)}%`;

		const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		let h: number;
		if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
		else if (max === g) h = ((b - r) / d + 2) / 6;
		else h = ((r - g) / d + 4) / 6;

		return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
	}

	function hslToHex(hsl: string): string {
		const [h, s, l] = hsl.split(/\s+/).map((part) => parseFloat(part));
		const a = (s / 100) * Math.min(l / 100, 1 - l / 100);

		const channel = (n: number) => {
			const k = (n + h / 30) % 12;
			const value = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
			return Math.round(255 * value)
				.toString(16)
				.padStart(2, '0');
		};

		return `#${channel(0)}${channel(8)}${channel(4)}`;
	}
</script>

<label class="border-line mb-6 flex items-start gap-2 rounded border p-3 text-sm">
	<input
		type="checkbox"
		class="mt-0.5"
		checked={$nudgeSetting}
		onchange={(event) => void nudgeSetting.setEnabled(event.currentTarget.checked)}
	/>
	<span>
		<span class="text-ink">Point out notes I have not used</span>
		<span class="text-ink-muted block text-xs">
			While writing, a small mark appears in the margin beside a paragraph you have already made a
			note about and not cited. It never interrupts, and clicking it opens your notes.
		</span>
	</span>
</label>

<h4 class="text-ink mb-2 text-sm font-medium">Labels</h4>

<p class="text-ink-muted mb-4 text-sm">
	Colours you can highlight with, and what each one means to you. Rename them, recolour them, or
	switch off the ones you do not use — a highlight always takes the label you used last, so the list
	only matters when you want to change it.
</p>

<ul class="flex flex-col gap-2">
	{#each labels as label, index (label.id)}
		<li class="border-line flex items-center gap-2 rounded border p-2">
			<input
				type="color"
				class="border-line h-7 w-9 shrink-0 cursor-pointer rounded border bg-transparent"
				aria-label="Colour for {label.name}"
				value={hslToHex(label.colour)}
				onchange={(event) => {
					labels[index].colour = hexToHsl(event.currentTarget.value);
					void persist(labels[index]);
				}}
			/>

			<input
				class="border-line bg-surface-sunken text-ink grow rounded border px-2 py-1 text-sm"
				aria-label="Name for this label"
				value={label.name}
				onblur={(event) => {
					const name = event.currentTarget.value.trim();
					if (!name || name === label.name) return;
					labels[index].name = name;
					void persist(labels[index]);
				}}
			/>

			<label class="text-ink-muted flex items-center gap-1 text-xs">
				<input
					type="checkbox"
					checked={label.enabled}
					onchange={(event) => {
						labels[index].enabled = event.currentTarget.checked;
						void persist(labels[index]);
					}}
				/>
				Show
			</label>

			<button
				class="text-ink-muted hover:text-danger hover:bg-surface-hover rounded p-1 disabled:opacity-40"
				disabled={saving === label.id}
				onclick={() => remove(label)}
				aria-label="Remove the label {label.name}"
				title="Remove. Highlights filed under it are kept, without a label."
			>
				<Icon icon="Trash" size="s" />
			</button>
		</li>
	{/each}
</ul>

<div class="mt-4 flex items-center justify-between gap-4">
	<p class="text-ink-muted text-xs">
		Removing a label keeps the highlights made with it. They simply stop having one, and can be
		filed again later.
	</p>

	<div class="flex shrink-0 items-center gap-2">
		<button
			class="border-line hover:bg-surface-hover rounded border px-2 py-1 text-xs"
			onclick={() => void useColourNames()}
			title="Rename every label after the colour it is — Yellow, Red, Green, and so on"
		>
			Name them after their colours
		</button>

		{#if labels.length < 8}
			<button
				class="border-line hover:bg-surface-hover rounded border px-2 py-1 text-xs"
				onclick={() => void restore()}
				title="Put back any of the eight defaults that are missing, leaving your own edits alone"
			>
				Restore the defaults
			</button>
		{/if}
	</div>
</div>
