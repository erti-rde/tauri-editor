<script lang="ts">
	import { get } from 'svelte/store';

	import { canonical } from '$lib/citations/aliases';
	import { listDocuments } from '$lib/editor/documents';
	import { describeError } from '$lib/ipc';
	import { loadManuscript, tauriFiles } from '$lib/manuscript/io';
	import { annotationsStore } from '$lib/stores/annotations.svelte';
	import { removeSource, sourceAliases, sourceRemoval } from '$lib/stores/db';
	import { fileSystemStore } from '$lib/stores/fileSystem.svelte';
	import { errorToast, successToast } from '$lib/toast/Toast.svelte';
	import { Button, ConfirmDialog } from '$lib/ui';
	import { workspaceStore } from '$lib/workspace/workspaceStore';

	import {
		carryInto,
		citationsIn,
		consequences as describe,
		filePlace,
		readAll,
		REMOVED,
		removalTitle,
		removedFile,
		separator,
		type CitedIn,
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
		/** Its metadata, for the manuscripts that cite it without a copy. */
		csl: object | null;
		onremoved: () => void | Promise<void>;
	}

	let { id, title, csl, onremoved }: Props = $props();

	let open = $state(false);
	let counting = $state(false);
	let busy = $state(false);
	let said: Consequences | null = $state(null);
	/**
	 * The source the dialog was counted for. The rows stay clickable while the
	 * manuscripts are read, and the dialog must remove what it described, not
	 * whichever source is selected by then.
	 */
	let asked: {
		id: string;
		title: string;
		work: string;
		csl: object | null;
		cited: CitedIn;
		/** Every file that goes with it, the work's own and each attached one's. */
		paths: string[];
	} | null = $state(null);

	/** Counted when asked, not before: reading every manuscript is for this dialog only. */
	async function ask() {
		const target = { id, title, csl };
		counting = true;
		try {
			const fs = get(fileSystemStore);
			const [aliases, removal, manuscripts] = await Promise.all([
				sourceAliases(),
				sourceRemoval(target.id),
				readAll(listDocuments(fs.items), (file) => loadManuscript(file, tauriFiles))
			]);
			const work = canonical(aliases, target.id);
			const cited = citationsIn(manuscripts, (cited) => canonical(aliases, cited) === work);
			asked = { ...target, work, cited, paths: removal.paths };
			said = describe({
				cited,
				notes: removal.notes,
				highlights: removal.highlights,
				file: filePlace(removal.paths, fs.currentPath)
			});
			open = true;
		} catch (error) {
			errorToast(`Could not check what removing it would affect: ${describeError(error)}`);
		} finally {
			counting = false;
		}
	}

	async function remove() {
		if (!asked) return;
		const gone = removedFile(asked.paths);
		busy = true;
		try {
			await carryInto(asked.cited.uncarried, { id: asked.work, csl: asked.csl }, tauriFiles);
			await removeSource(asked.id);
		} catch (error) {
			errorToast(`Could not remove it: ${describeError(error)}`);
			return;
		} finally {
			busy = false;
		}
		open = false;
		// A reader left open on one of its files would draw marks that are gone,
		// and saving a new one would fail on the source it belongs to (#222).
		workspaceStore.closeWhere((tab) => tab.kind === 'pdf' && gone(tab.id));
		annotationsStore.dropIf(gone);
		successToast(REMOVED);
		try {
			await onremoved();
		} catch (error) {
			errorToast(
				`Removed, but the list of sources could not be refreshed: ${describeError(error)}`
			);
		}
	}
</script>

<Button variant="ghost" loading={counting} onclick={ask}>Remove from library…</Button>

<ConfirmDialog
	bind:open
	title={removalTitle(asked?.title ?? title)}
	action="Remove"
	{busy}
	onConfirm={remove}
>
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
