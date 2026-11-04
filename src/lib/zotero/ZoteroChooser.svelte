<script lang="ts">
	import { onMount } from 'svelte';

	import type { CslMaps } from '$lib/import/zotero';
	import { describeError, type ZoteroPick } from '$lib/ipc';
	import { zoteroCslMaps } from '$lib/metadata-explorer/adapterCslZotero';
	import { Banner, Checkbox } from '$lib/ui';

	import { previewZotero, type ZoteroPreview } from './importZotero';
	import ZoteroPicker from './ZoteroPicker.svelte';

	/**
	 * The one place Zotero is chosen from (M1b-11, UX-13), for New project and
	 * for Sources › Add › From Zotero: the tree, then what the ticked papers
	 * come to against the library, before anything is written (AC-5).
	 */
	interface Props {
		picks?: ZoteroPick[];
		/** What the picks come to, once read; null while there's nothing or it's reading. */
		preview?: ZoteroPreview | null;
		/** Keep the project in step with what's ticked (AC-8). */
		follow?: boolean;
		disabled?: boolean;
		/** "this project", or the new project's name. */
		project?: string;
	}

	let {
		picks = $bindable([]),
		preview = $bindable(null),
		follow = $bindable(true),
		disabled = false,
		project = 'this project'
	}: Props = $props();

	let maps = $state.raw<CslMaps | null>(null);
	let reading = $state(false);
	let failed = $state<string | null>(null);

	onMount(async () => {
		try {
			maps = await zoteroCslMaps();
		} catch (error) {
			failed = describeError(error);
		}
	});

	// Read again a moment after the ticking stops, not on every box.
	$effect(() => {
		const asked = picks;
		const using = maps;
		preview = null;
		failed = null;
		if (!using || asked.length === 0) return;
		reading = true;
		const timer = setTimeout(async () => {
			try {
				const read = await previewZotero(asked, using);
				if (picks === asked) preview = read;
			} catch (error) {
				if (picks === asked) failed = describeError(error);
			} finally {
				if (picks === asked) reading = false;
			}
		}, 300);
		return () => clearTimeout(timer);
	});

	const count = (n: number) => n.toLocaleString('en-GB');
	const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

	/** "21 works · 19 PDFs to attach · 4 already in your library · 1 PDF can’t be attached" */
	const summary = $derived.by(() => {
		if (!preview) return [];
		const parts: { text: string; strong?: boolean }[] = [
			{ text: `${plural(preview.fresh.length, 'new work', 'new works')}`, strong: true }
		];
		if (preview.pdfs > 0) {
			parts.push({ text: `${plural(preview.pdfs, 'PDF', 'PDFs')} to attach`, strong: true });
		}
		if (preview.known.length > 0) {
			parts.push({
				text: `${count(preview.known.length)} already in your library, added to ${project}`
			});
		}
		if (preview.unattachable.length > 0) {
			const n = preview.unattachable.length;
			parts.push({ text: `${plural(n, 'PDF', 'PDFs')} can’t be attached`, strong: true });
		}
		if (preview.unreadable.length > 0) {
			parts.push({ text: `${count(preview.unreadable.length)} unreadable`, strong: true });
		}
		return parts;
	});
</script>

<div class="grid gap-3">
	<ZoteroPicker bind:picks {disabled} />

	{#if failed}
		<Banner tone="warning">Erti can’t read what’s ticked. {failed}</Banner>
	{:else if picks.length === 0}
		<p class="text-small text-ink-muted">Tick the collections and papers to bring in.</p>
	{:else if !preview}
		<p class="text-small text-ink-muted" aria-live="polite">
			{reading ? 'Reading from Zotero…' : ''}
		</p>
	{:else}
		<!-- M1b-11 AC-5: what's new, what the library has, and which PDFs can't come. -->
		<p class="text-small text-ink" data-testid="zotero-summary" aria-live="polite">
			{#each summary as part, i (part.text)}
				{i > 0 ? ' · ' : ''}{#if part.strong}<strong>{part.text}</strong>{:else}{part.text}{/if}
			{/each}
		</p>
		{#if preview.unattachable.length > 0}
			<details class="text-small">
				<summary class="text-ink-muted cursor-default">Which PDFs, and why</summary>
				<ul class="text-caption text-ink-muted mt-1 grid max-h-32 gap-1 overflow-y-auto">
					{#each preview.unattachable as pdf (pdf.title + pdf.file)}
						<li>
							<span class="text-ink">{pdf.file}</span>, for “{pdf.title}”: {pdf.reason}
						</li>
					{/each}
				</ul>
			</details>
		{/if}
		{#if preview.unreadable.length > 0}
			<ul class="text-caption text-ink-muted grid gap-1">
				{#each preview.unreadable as entry (entry.key)}
					<li>{entry.key}: {entry.reason}</li>
				{/each}
			</ul>
		{/if}
	{/if}

	<Checkbox
		label="Keep in step with Zotero"
		description="Sources then says when papers are added to these in Zotero, and Sync brings them in. Nothing is removed."
		bind:checked={follow}
		{disabled}
	/>
</div>
