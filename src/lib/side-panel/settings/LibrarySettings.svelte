<script lang="ts">
	import { homeDir } from '@tauri-apps/api/path';
	import { open } from '@tauri-apps/plugin-dialog';
	import { onMount } from 'svelte';

	import { call, commands, describeError, run, type LibraryBackups } from '$lib/ipc';
	import { log } from '$lib/log';
	import { openBackupFolder, reopenAfterRestore, savedForReopen } from '$lib/stores/backups';
	import { Button, Dialog, RadioCard, RadioCardGroup, SettingRow } from '$lib/ui';
	import { errorToast, successToast } from '$lib/ui/Toast.svelte';

	import { keptLine, shortPath, whatItIs, whenTaken } from './library';

	/**
	 * Settings › Library (M5-10, UX-10): where the library is, and its backups
	 * (ADR 008). Everything here acts at once, like Appearance; nothing waits
	 * for Save.
	 */

	let library = $state<LibraryBackups | null>(null);
	let home = $state('');
	let failed = $state<string | null>(null);
	let busy = $state<'move' | 'backup' | 'restore' | null>(null);

	let restoring = $state(false);
	let chosen = $state('');
	const choice = $derived(library?.backups.find((b) => b.name === chosen));

	async function load() {
		try {
			library = await call(commands.libraryBackups());
			failed = null;
		} catch (error) {
			log.error('Could not list the library backups', error);
			failed = describeError(error);
		}
	}

	onMount(async () => {
		home = await homeDir().catch(() => '');
		await load();
	});

	async function move() {
		const folder = await open({
			directory: true,
			multiple: false,
			title: 'Move the library to…'
		});
		if (typeof folder !== 'string') return;
		busy = 'move';
		try {
			const moved = await call(commands.moveLibrary(folder));
			await load();
			successToast(
				`Moved the library to ${shortPath(moved.path, home)}`,
				moved.backupsLeft > 0
					? `${moved.backupsLeft === 1 ? 'One backup' : `${moved.backupsLeft} backups`} stayed in the old backup folder.`
					: undefined
			);
		} catch (error) {
			log.error('Could not move the library', error);
			errorToast(describeError(error));
		} finally {
			busy = null;
		}
	}

	async function backUp() {
		busy = 'backup';
		try {
			await run(commands.backUpLibrary());
			await load();
		} catch (error) {
			log.error('Could not back up the library', error);
			errorToast(describeError(error));
		} finally {
			busy = null;
		}
	}

	function startRestore() {
		chosen = library?.backups[0]?.name ?? '';
		restoring = true;
	}

	async function restore() {
		if (!choice) return;
		busy = 'restore';
		try {
			// The window starts again after, so the manuscript is written first.
			if (!(await savedForReopen())) {
				errorToast("Couldn't save your document, so nothing was restored. Try again.");
				return;
			}
			const restored = await call(commands.restoreLibrary(choice.name));
			restoring = false;
			reopenAfterRestore(restored.replaced);
		} catch (error) {
			log.error('Could not restore the library', error);
			errorToast(describeError(error));
			await load();
		} finally {
			busy = null;
		}
	}

	const newest = $derived(library?.backups[0]);
</script>

<div class="grid">
	{#if failed}
		<p class="text-small text-danger pb-3" role="alert">
			Couldn't read the library's backups: {failed}
		</p>
	{/if}

	<SettingRow
		label="Location"
		hint={library
			? shortPath(library.path, home)
			: 'The file your sources, notes and marks are kept in'}
	>
		{#snippet children({ labelId, hintId })}
			<Button
				size="sm"
				aria-describedby="{labelId} {hintId}"
				loading={busy === 'move'}
				disabled={!library || busy !== null}
				onclick={move}
			>
				Move library…
			</Button>
		{/snippet}
	</SettingRow>

	<SettingRow
		label="Last backup"
		hint={library
			? `${newest ? whenTaken(newest.takenAt) : 'None yet'} · ${keptLine(library.keepDays, library.keepWeeks)}`
			: undefined}
	>
		{#snippet children({ labelId, hintId })}
			<Button
				size="sm"
				aria-describedby="{labelId} {hintId}"
				loading={busy === 'backup'}
				disabled={!library || busy !== null}
				onclick={backUp}
			>
				{busy === 'backup' ? 'Backing up…' : 'Back up now'}
			</Button>
		{/snippet}
	</SettingRow>

	<SettingRow
		label="Restore"
		hint="Put a backup in the library's place. The library it replaces is kept."
	>
		{#snippet children({ hintId })}
			<Button
				size="sm"
				aria-describedby={hintId}
				disabled={!library?.backups.length || busy !== null}
				onclick={startRestore}
			>
				Restore from a backup…
			</Button>
		{/snippet}
	</SettingRow>

	<SettingRow label="Backup folder" hint={library ? shortPath(library.folder, home) : undefined}>
		{#snippet children({ hintId })}
			<Button
				size="sm"
				aria-describedby={hintId}
				disabled={!library}
				onclick={() => void openBackupFolder()}
			>
				Open backup folder
			</Button>
		{/snippet}
	</SettingRow>

	<p class="border-line text-caption text-ink-muted border-t pt-3">
		A backup is also taken before every library upgrade.
	</p>
</div>

<Dialog
	bind:open={restoring}
	title="Restore from a backup"
	description="Your library goes back to how it was then. Sources, notes and marks added since stay in the library it replaces, which is kept in the backup folder."
	dismissible={busy !== 'restore'}
>
	{#if library}
		<RadioCardGroup label="Backups" columns={1} bind:value={chosen}>
			{#each library.backups as backup (backup.name)}
				<RadioCard
					value={backup.name}
					label={whenTaken(backup.takenAt)}
					description={whatItIs(backup)}
				/>
			{/each}
		</RadioCardGroup>
	{/if}

	{#snippet footer()}
		<Button disabled={busy === 'restore'} onclick={() => (restoring = false)}>Cancel</Button>
		<Button variant="primary" loading={busy === 'restore'} disabled={!choice} onclick={restore}>
			{busy === 'restore' ? 'Restoring…' : 'Restore this backup'}
		</Button>
	{/snippet}
</Dialog>
