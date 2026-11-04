<script lang="ts">
	import { open as pickFolder } from '@tauri-apps/plugin-dialog';
	import { documentDir } from '@tauri-apps/api/path';

	import { call, commands, describeError, type ZoteroPick } from '$lib/ipc';
	import { augmentSchema } from '$lib/metadata-explorer/adapterCslZotero';
	import { ImportStopped, type Imported } from '$lib/metadata-explorer/bibliography';
	import { openProject } from '$lib/stores/db';
	import {
		Banner,
		Button,
		Dialog,
		ProgressLine,
		RadioCard,
		RadioCardGroup,
		TextField
	} from '$lib/ui';
	import { importZotero, type ZoteroPreview } from '$lib/zotero/importZotero';
	import ZoteroChooser from '$lib/zotero/ZoteroChooser.svelte';

	/**
	 * Landing › New project… (M1b-11 AC-1, docs/ux.md UX-13): a name, a place,
	 * and what to start with. From Zotero, the ticked papers are imported here,
	 * with progress, before the workspace opens on them.
	 */
	interface Props {
		open?: boolean;
		/** Open the project made at `path`, as a recent one is opened. */
		onready: (path: string, imported: Imported | null) => Promise<void>;
	}

	let { open = $bindable(false), onready }: Props = $props();

	let name = $state('');
	let location = $state<string | null>(null);
	let start = $state<'empty' | 'zotero'>('empty');
	let picks = $state.raw<ZoteroPick[]>([]);
	let preview = $state.raw<ZoteroPreview | null>(null);
	let follow = $state(true);

	let nameError = $state<string | null>(null);
	let failed = $state<string | null>(null);
	let progress = $state<{ label: string; done: number; total: number } | null>(null);
	let busy = $state(false);
	let body: HTMLElement | undefined = $state();

	/** Closed: the next New project starts afresh, in the place chosen last. */
	function close() {
		open = false;
		name = '';
		start = 'empty';
		nameError = null;
		failed = null;
		progress = null;
	}

	async function chooseLocation() {
		const folder = await pickFolder({
			title: 'Choose where to make the project',
			directory: true,
			multiple: false,
			defaultPath: location ?? (await documentDir())
		});
		if (typeof folder === 'string') location = folder;
	}

	const fromZotero = $derived(start === 'zotero');
	const papers = $derived(preview ? preview.fresh.length + preview.known.length : 0);
	const ready = $derived(
		name.trim() !== '' && location !== null && !busy && (!fromZotero || papers > 0)
	);

	async function create() {
		if (!ready || !location) return;
		busy = true;
		nameError = null;
		failed = null;
		let path: string;
		try {
			path = await call(commands.createProject(location, name.trim()));
		} catch (error) {
			nameError = describeError(error);
			busy = false;
			return;
		}

		let imported: Imported | null = null;
		if (fromZotero && preview) {
			try {
				await openProject(path);
				imported = await importZotero(preview, await augmentSchema(), {
					follow: follow ? picks : null,
					onprogress: (step, done, total) =>
						(progress = {
							label: step === 'importing' ? 'Importing from Zotero' : 'Attaching PDFs',
							done,
							total
						})
				});
			} catch (error) {
				// What was added stays added; the project opens on it.
				imported = error instanceof ImportStopped ? error.imported : null;
				failed = describeError(error instanceof ImportStopped ? error.reason : error);
			}
		}
		try {
			await onready(path, imported);
			close();
		} catch (error) {
			failed = describeError(error);
		} finally {
			busy = false;
			progress = null;
		}
	}
</script>

<Dialog
	{open}
	onOpenChange={(next) => !next && close()}
	onOpenAutoFocus={(event) => {
		// The name first: it's what's asked first.
		event.preventDefault();
		body?.querySelector('input')?.focus();
	}}
	size="lg"
	title="New project"
	description="A project is a folder for your writing. PDFs from Zotero stay where Zotero keeps them."
	dismissible={!busy}
>
	<div class="grid gap-4" bind:this={body}>
		<TextField
			label="Name"
			bind:value={name}
			placeholder="Thesis"
			error={nameError ?? undefined}
			disabled={busy}
		/>

		<div class="grid gap-1">
			<span class="text-small text-ink font-medium" id="new-project-location">Location</span>
			<div class="flex items-center gap-2">
				<span
					class="text-small text-ink-muted min-w-0 flex-1 truncate font-mono"
					data-testid="new-project-location"
				>
					{location ?? 'Not chosen yet'}
				</span>
				<Button variant="secondary" size="sm" onclick={chooseLocation} disabled={busy}>
					Choose…
				</Button>
			</div>
			{#if location && name.trim()}
				<span class="text-caption text-ink-muted">
					Makes the folder “{name.trim()}” there.
				</span>
			{/if}
		</div>

		<RadioCardGroup
			label="Start with"
			columns={2}
			value={start}
			disabled={busy}
			onValueChange={(value) => (start = value as 'empty' | 'zotero')}
		>
			<RadioCard value="empty" label="Empty" description="Add PDFs and sources as you go." />
			<RadioCard
				value="zotero"
				label="From Zotero"
				description="Choose collections and papers from your Zotero library."
			/>
		</RadioCardGroup>

		{#if fromZotero}
			<ZoteroChooser
				bind:picks
				bind:preview
				bind:follow
				disabled={busy}
				project={name.trim() ? `“${name.trim()}”` : 'the project'}
			/>
		{/if}

		{#if progress}
			<ProgressLine label={progress.label} value={progress.done} max={progress.total} />
		{/if}
		{#if failed}
			<Banner tone="warning">{failed}</Banner>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="ghost" onclick={close} disabled={busy}>Cancel</Button>
		<Button variant="primary" onclick={create} disabled={!ready} loading={busy}>
			{busy ? 'Creating…' : 'Create project'}
		</Button>
	{/snippet}
</Dialog>
