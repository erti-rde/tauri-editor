<script lang="ts">
	import { get } from 'svelte/store';

	import { canonical } from '$lib/citations/aliases';
	import { listDocuments } from '$lib/editor/documents';
	import { describeError } from '$lib/ipc';
	import { loadManuscript, tauriFiles } from '$lib/manuscript/io';
	import { removeSource, sourceAliases, sourceRemoval } from '$lib/stores/db';
	import { fileSystemStore } from '$lib/stores/fileSystem.svelte';
	import { errorToast, successToast } from '$lib/toast/Toast.svelte';
	import { Button, ConfirmDialog } from '$lib/ui';

	import {
		citationsInProject,
		consequences as describe,
		filePlace,
		REMOVED,
		removalTitle,
		separator,
		type Consequences
	} from './removal';

	/**
	 * Remove a source from the library, after a dialog that says what goes with
	 * it (M1b-4, docs/ux.md UX-4): where it's cited, its notes and highlights,
	 * and what happens to the PDF.
	 */
	interface Props {
		/** The work's id, or any of its files'. */
		id: string;
		/** What the researcher calls it: its title, or the file's name. */
		title: string;
		/** Where its PDF is, if it has one. */
		path: string | null;
		onremoved: () => void;
	}

	let { id, title, path, onremoved }: Props = $props();

	let open = $state(false);
	let counting = $state(false);
	let busy = $state(false);
	let said: Consequences | null = $state(null);

	/** Counted when asked, not before: reading every manuscript is for this dialog only. */
	async function ask() {
		counting = true;
		try {
			const aliases = await sourceAliases();
			const work = canonical(aliases, id);
			const fs = get(fileSystemStore);
			const [removal, cited] = await Promise.all([
				sourceRemoval(id),
				citationsInProject(
					listDocuments(fs.items),
					(file) => loadManuscript(file, tauriFiles),
					(cited) => canonical(aliases, cited) === work
				)
			]);
			said = describe({ cited, ...removal, file: filePlace(path, fs.currentPath) });
			open = true;
		} catch (error) {
			errorToast(`Could not check what removing it would affect: ${describeError(error)}`);
		} finally {
			counting = false;
		}
	}

	async function remove() {
		busy = true;
		try {
			await removeSource(id);
			open = false;
			successToast(REMOVED);
			onremoved();
		} catch (error) {
			errorToast(`Could not remove it: ${describeError(error)}`);
		} finally {
			busy = false;
		}
	}
</script>

<Button variant="ghost" loading={counting} onclick={ask}>Remove from library…</Button>

<ConfirmDialog bind:open title={removalTitle(title)} action="Remove" {busy} onConfirm={remove}>
	{#snippet consequences()}
		{#if said?.cited}
			<p>
				{said.cited.before}
				{#each said.cited.documents as document, i (document)}
					<em>{document}</em>{separator(i, said.cited.documents.length)}
				{/each}
				{said.cited.after}
			</p>
		{/if}
		{#if said?.deleted}
			<p>{said.deleted}</p>
		{/if}
		{#if said?.file}
			<p>{said.file}</p>
		{/if}
		{#if said && !said.cited && !said.deleted && !said.file}
			<p>Nothing cites it, and it has no notes, highlights or file.</p>
		{/if}
	{/snippet}
</ConfirmDialog>
