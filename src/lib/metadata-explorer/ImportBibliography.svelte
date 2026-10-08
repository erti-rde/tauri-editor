<script lang="ts">
	import { open as pickFolder } from '@tauri-apps/plugin-dialog';
	import { readTextFile } from '@tauri-apps/plugin-fs';

	import { describeError } from '$lib/ipc';
	import { errorToast } from '$lib/toast/Toast.svelte';
	import { Banner, Button, Checkbox, Dialog, Loader, ProgressLine } from '$lib/ui';

	import type { AugmentedZoteroSchema } from './adapterCslZotero';
	import {
		attachPdfs,
		commonFolder,
		fileNameOf,
		importEntries,
		ImportStopped,
		locatePdfs,
		previewImport,
		type Imported,
		type Preview
	} from './bibliography';

	/**
	 * Sources › Add › Import a bibliography… (M1b-9, docs/ux.md UX-6): what the
	 * file holds, against what the library has, before anything is written;
	 * then the new entries imported, with progress, and the PDFs they name
	 * attached.
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

	let preview: Preview | null = $state.raw(null);
	/** Why the file couldn't be previewed. */
	let failed: string | null = $state(null);
	let toProject = $state(false);
	/** How far the import has got, while it's under way. */
	let progress: { done: number; total: number; attaching?: boolean } | null = $state(null);
	/** The PDFs the new entries name, sorted into those Erti can attach and the rest. */
	let located: { found: Set<string>; missing: string[] } | null = $state.raw(null);

	$effect(() => {
		const picked = path;
		preview = null;
		failed = null;
		progress = null;
		located = null;
		toProject = false;
		if (!picked) return;
		readTextFile(picked)
			.then((text) => previewImport(picked, text))
			.then(async (read) => {
				if (path !== picked) return;
				preview = read;
				if (read.pdfs.length > 0) await locate(read);
			})
			.catch((error) => {
				if (path === picked) failed = describeError(error);
			});
	});

	async function locate(read: Preview) {
		const sorted = await locatePdfs(read.pdfs);
		if (preview === read) located = sorted;
	}

	/**
	 * Erti looks only where the user has shown it (M1a-3). A folder picked here
	 * is shown for the session, as any picked folder is, and the PDFs in it are
	 * looked for again.
	 */
	async function chooseFolder() {
		if (!preview || !located) return;
		const read = preview;
		const folder = await pickFolder({
			title: 'Choose the folder the PDFs are in',
			directory: true,
			recursive: true,
			multiple: false,
			defaultPath: commonFolder(located.missing)
		});
		if (typeof folder !== 'string') return;
		try {
			await locate(read);
		} catch (error) {
			errorToast(`Could not look for the PDFs: ${describeError(error)}`);
		}
	}

	/** New entries with a PDF that will be attached. */
	const withPdf = $derived.by(() => {
		const found = located?.found;
		if (!preview || !found) return 0;
		return preview.fresh.filter((entry) => entry.files.some((file) => found.has(file))).length;
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
		if (located && withPdf > 0) {
			parts.push({
				text: `${count(withPdf)} with a PDF`,
				strong: true,
				note: 'that will be attached'
			});
		}
		if (located && located.missing.length > 0) {
			const n = located.missing.length;
			parts.push({ text: `${count(n)} ${n === 1 ? 'PDF' : 'PDFs'} not found`, strong: true });
		}
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
		let imported: Imported;
		try {
			imported = await importEntries(fresh, schema, {
				toProject,
				found: located?.found,
				onprogress: (done, total) => (progress = { done, total })
			});
		} catch (error) {
			const stopped = error instanceof ImportStopped ? error : null;
			errorToast(
				`The import stopped after ${count(stopped?.imported.added.length ?? 0)} of ${count(fresh.length)}: ${describeError(stopped?.reason ?? error)}`
			);
			if (!stopped?.imported.added.length) return onclose();
			imported = stopped.imported;
		}
		// What was added has its PDFs, even when the import stopped part way.
		if (imported.pdfs.length > 0) {
			progress = { done: 0, total: imported.pdfs.length, attaching: true };
			imported = await attachPdfs(
				imported,
				(done, total) => (progress = { done, total, attaching: true })
			);
		}
		onimported(imported, toProject);
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
						aria-label="Couldn’t read"
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

			{#if located && located.missing.length > 0}
				<!-- M1b-9 AC-4: the PDFs it names that Erti can't see, and where to show it them. -->
				<div>
					<h3 class="text-caption text-ink-muted mb-1 font-medium">PDFs not found</h3>
					<ul
						class="divide-line border-line text-small max-h-32 divide-y overflow-auto rounded border"
						aria-label="PDFs not found"
					>
						{#each located.missing as missing (missing)}
							<li class="text-ink-muted px-3 py-2 break-all">{missing}</li>
						{/each}
					</ul>
					<div class="mt-2 flex items-center justify-between gap-3">
						<p class="text-caption text-ink-muted">
							Erti looks only in this project and in folders you’ve shown it.
						</p>
						<Button size="sm" disabled={!!progress} onclick={chooseFolder}>Choose folder…</Button>
					</div>
				</div>
			{/if}

			{#if preview.fresh.length === 0}
				<p class="text-small text-ink-muted">There’s nothing in it your library doesn’t have.</p>
			{:else if progress}
				<!-- M1b-9 AC-6 -->
				<ProgressLine
					label={progress.attaching ? 'Attaching PDFs' : 'Importing'}
					value={progress.done}
					max={progress.total}
				/>
			{:else}
				<Checkbox label="Also add them to this project" bind:checked={toProject} />
			{/if}
		</div>
	{/if}

	{#snippet footer()}
		<Button variant="ghost" disabled={!!progress} onclick={onclose}>Cancel</Button>
		{#if preview && preview.fresh.length > 0}
			<!-- Not before the PDFs are looked for: what's found is what gets attached. -->
			<Button
				variant="primary"
				loading={!!progress}
				disabled={preview.pdfs.length > 0 && !located}
				onclick={start}
			>
				{progress
					? progress.attaching
						? `Attaching ${count(progress.done)} of ${count(progress.total)} PDFs…`
						: `Importing ${count(progress.done)} of ${count(progress.total)}…`
					: `Import ${count(preview.fresh.length)}`}
			</Button>
		{/if}
	{/snippet}
</Dialog>
