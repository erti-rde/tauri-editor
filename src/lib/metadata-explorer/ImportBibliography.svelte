<script lang="ts">
	import { readTextFile } from '@tauri-apps/plugin-fs';

	import { describeError } from '$lib/ipc';
	import { errorToast } from '$lib/toast/Toast.svelte';
	import { Banner, Button, Checkbox, Dialog, Loader, ProgressLine } from '$lib/ui';

	import type { AugmentedZoteroSchema } from './adapterCslZotero';
	import {
		fileNameOf,
		importEntries,
		ImportStopped,
		previewImport,
		type Imported,
		type Preview
	} from './bibliography';

	/**
	 * Sources › Add › Import a bibliography… (M1b-9, docs/ux.md UX-6): what the
	 * file holds, against what the library has, before anything is written;
	 * then the new entries imported, with progress.
	 */
	interface Props {
		/** The file picked to import; the dialog is open while there is one. */
		path: string | null;
		schema: AugmentedZoteroSchema;
		/** Imported, all of it or as far as it got: the sources added. */
		onimported: (imported: Imported, toProject: boolean) => void;
		onclose: () => void;
	}

	let { path, schema, onimported, onclose }: Props = $props();

	let preview: Preview | null = $state(null);
	/** Why the file couldn't be previewed. */
	let failed: string | null = $state(null);
	let toProject = $state(false);
	/** How far the import has got, while it's under way. */
	let progress: { done: number; total: number } | null = $state(null);

	$effect(() => {
		const picked = path;
		preview = null;
		failed = null;
		progress = null;
		toProject = false;
		if (!picked) return;
		readTextFile(picked)
			.then((text) => previewImport(fileNameOf(picked), text))
			.then((read) => {
				if (path === picked) preview = read;
			})
			.catch((error) => {
				if (path === picked) failed = describeError(error);
			});
	});

	const count = (n: number) => n.toLocaleString('en-GB');
	const entries = (n: number) => `${count(n)} ${n === 1 ? 'entry' : 'entries'}`;

	/** "412 entries · 380 new · 32 already in your library (matched by DOI or title)" (UX-6). */
	const summary = $derived.by(() => {
		if (!preview) return [];
		const parts: { text: string; strong?: boolean; note?: string }[] = [
			{ text: entries(preview.total) },
			{ text: `${count(preview.fresh.length)} new`, strong: true },
			{
				text: `${count(preview.known.length)} already in your library`,
				strong: true,
				note: '(matched by DOI or title)'
			}
		];
		if (preview.repeated.length > 0) {
			parts.push({ text: `${count(preview.repeated.length)} listed twice in the file` });
		}
		if (preview.unreadable.length > 0) {
			parts.push({ text: `${count(preview.unreadable.length)} unreadable`, strong: true });
		}
		return parts;
	});

	/** "smith2020, line 12", "Line 12", or nothing when it's the whole file. */
	function whereIs({ key, line }: Preview['unreadable'][number]): string {
		if (key !== null) return line !== null ? `${key}, line ${line}` : key;
		return line !== null ? `Line ${line}` : '';
	}

	async function start() {
		if (!preview || progress) return;
		const fresh = preview.fresh;
		progress = { done: 0, total: fresh.length };
		try {
			const imported = await importEntries(fresh, schema, {
				toProject,
				onprogress: (done, total) => (progress = { done, total })
			});
			onimported(imported, toProject);
		} catch (error) {
			const stopped = error instanceof ImportStopped ? error : null;
			errorToast(
				`The import stopped after ${count(stopped?.imported.added.length ?? 0)} of ${count(fresh.length)}: ${describeError(stopped?.reason ?? error)}`
			);
			if (stopped?.imported.added.length) onimported(stopped.imported, toProject);
			else onclose();
		}
	}
</script>

<Dialog
	open={path !== null}
	onOpenChange={(open) => !open && onclose()}
	size="md"
	title={`Import ${path ? fileNameOf(path) : ''}`}
	description={preview ? undefined : 'Nothing is added until you say.'}
	dismissible={!progress}
>
	{#if failed}
		<Banner tone="warning">Erti can’t import it. {failed}</Banner>
	{:else if !preview}
		<div class="flex justify-center"><Loader /></div>
	{:else}
		<div class="grid gap-3">
			<!-- M1b-9 AC-4: what's new, what the library has, and what it couldn't read. -->
			<p class="text-small text-ink" data-testid="import-summary">
				{#each summary as part, i (part.text)}
					{i > 0 ? ' · ' : ''}{#if part.strong}<strong>{part.text}</strong
						>{:else}{part.text}{/if}{part.note ? ` ${part.note}` : ''}
				{/each}
			</p>

			{#if preview.unreadable.length > 0}
				<div>
					<h3 class="text-caption text-ink-muted mb-1 font-medium">Couldn’t read</h3>
					<ul
						class="divide-line border-line text-small max-h-48 divide-y overflow-auto rounded border"
					>
						{#each preview.unreadable as entry, i (i)}
							<li class="px-3 py-2">
								{#if whereIs(entry)}
									<span class="text-ink font-medium">{whereIs(entry)}:</span>
								{/if}
								<span class="text-ink-muted">{entry.reason}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if preview.fresh.length === 0}
				<p class="text-small text-ink-muted">There’s nothing in it your library doesn’t have.</p>
			{:else if progress}
				<!-- M1b-9 AC-6 -->
				<ProgressLine label="Importing" value={progress.done} max={progress.total} />
			{:else}
				<Checkbox label="Also add them to this project" bind:checked={toProject} />
			{/if}
		</div>
	{/if}

	{#snippet footer()}
		<Button variant="ghost" disabled={!!progress} onclick={onclose}>Cancel</Button>
		{#if preview && preview.fresh.length > 0}
			<Button variant="primary" loading={!!progress} onclick={start}>
				{progress
					? `Importing ${count(progress.done)} of ${count(progress.total)}…`
					: `Import ${count(preview.fresh.length)}`}
			</Button>
		{/if}
	{/snippet}
</Dialog>
