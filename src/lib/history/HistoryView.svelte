<script lang="ts">
	import { untrack } from 'svelte';
	import X from '~icons/lucide/x';

	import type { ProjectDocument } from '$lib/editor/documents';
	import { Editor } from '$lib/editor/core/Editor';
	import { editorExtensions } from '$lib/editor/core/extensions';
	import { countSavedWords } from '$lib/editor/wordCount';
	import { call, commands, describeError, type History, type Snapshot } from '$lib/ipc';
	import { log } from '$lib/log';
	import { loadManuscript, parseManuscript, tauriFiles, type Content } from '$lib/manuscript/io';
	import { errorToast, successToast } from '$lib/toast/Toast.svelte';
	import {
		Banner,
		Button,
		ConfirmDialog,
		EmptyState,
		IconButton,
		Item,
		PanelHeader
	} from '$lib/ui';

	import {
		byDay,
		CLEAR_AFTER_DAYS,
		clearable,
		previewLine,
		RESTORED,
		rowText,
		sizeLabel
	} from './history';

	/**
	 * A document's history (M5-1 AC-4, docs/ux.md UX-9): its snapshots by day,
	 * one shown read-only in the manuscript's face, and **Restore this version**,
	 * which keeps the current state as a snapshot first, so a restore can itself
	 * be undone. Nothing is changed by looking.
	 */
	interface Props {
		document: ProjectDocument;
		/** Back to the document, which the editor reads afresh from disk. */
		onclose: () => void;
	}

	let { document: doc, onclose }: Props = $props();

	let history = $state.raw<History | null>(null);
	let failure = $state<string | null>(null);
	let now = $state(new Date());
	let shown = $state.raw<{ snapshot: Snapshot; content: Content | null } | null>(null);
	let restoring = $state(false);
	let confirmingClear = $state(false);
	let clearing = $state(false);
	let host = $state<HTMLElement>();

	const days = $derived(history ? byDay(history.snapshots, now) : []);
	const old = $derived(history ? clearable(history.snapshots, now) : 0);

	async function load() {
		try {
			now = new Date();
			history = await call(commands.snapshotHistory(doc.path));
			failure = null;
			const keep = history.snapshots.find((s) => s.file === shown?.snapshot.file);
			const next = keep ?? history.snapshots[0];
			if (next) await choose(next);
			else shown = null;
		} catch (error) {
			failure = describeError(error);
		}
	}

	$effect(() => {
		void doc.path;
		untrack(() => void load());
	});

	async function choose(snapshot: Snapshot) {
		if (shown?.snapshot.file === snapshot.file && shown.content) return;
		try {
			const loaded = parseManuscript(await call(commands.readSnapshot(doc.path, snapshot.file)));
			const readable = loaded.status === 'ok' || loaded.status === 'newer';
			shown = { snapshot, content: readable ? loaded.content : null };
		} catch (error) {
			log.warn(`Could not read the snapshot ${snapshot.file}`, error);
			shown = { snapshot, content: null };
		}
	}

	// The snapshot in the manuscript's own face, built afresh for each one and
	// never editable: a preview that took typing would be a second document.
	$effect(() => {
		const content = shown?.content;
		const element = host;
		if (!content || !element) return;
		const viewer = new Editor({
			element,
			extensions: editorExtensions,
			content,
			editable: false,
			editorProps: {
				attributes: { class: 'manuscript px-12 py-10', 'aria-label': 'The snapshot, read-only' }
			}
		});
		return () => viewer.destroy();
	});

	async function restore() {
		if (!shown?.content || restoring) return;
		restoring = true;
		try {
			// Its words now label the snapshot of it the restore keeps first.
			const current = await loadManuscript(doc.path, tauriFiles);
			const words =
				current.status === 'ok' || current.status === 'newer'
					? countSavedWords(current.content)
					: null;
			await call(commands.restoreSnapshot(doc.path, shown.snapshot.file, words));
			successToast(RESTORED);
			onclose();
		} catch (error) {
			errorToast(`Could not restore this version: ${describeError(error)}`);
		} finally {
			restoring = false;
		}
	}

	async function clear() {
		clearing = true;
		try {
			await call(commands.clearSnapshots(doc.path, CLEAR_AFTER_DAYS));
			confirmingClear = false;
			await load();
		} catch (error) {
			errorToast(`Could not clear old snapshots: ${describeError(error)}`);
		} finally {
			clearing = false;
		}
	}

	const snapshotCount = (n: number) => `${n.toLocaleString('en-GB')} snapshot${n === 1 ? '' : 's'}`;
</script>

<section class="bg-surface flex h-full min-h-0" aria-labelledby="history-title">
	<div class="border-line flex w-72 shrink-0 flex-col border-r">
		<PanelHeader id="history-title" title={`History of ${doc.title}`}>
			{#snippet action()}
				<IconButton label="Back to the document" icon={X} size="sm" onclick={onclose} />
			{/snippet}
		</PanelHeader>

		<div class="min-h-0 flex-1 overflow-y-auto">
			{#if failure}
				<Banner tone="danger" action={{ label: 'Try again', onclick: () => void load() }}>
					Could not read this document’s history: {failure}
				</Banner>
			{:else if history && history.snapshots.length === 0}
				<EmptyState
					message="No snapshots of this document yet."
					detail="One is kept every ten minutes while you write, and when you close the document."
				/>
			{:else}
				{#each days as day (day.label)}
					<section aria-label={day.label}>
						<h3 class="text-caption text-ink-muted px-3 pt-3 pb-1 font-medium">{day.label}</h3>
						{#each day.rows as row (row.snapshot.file)}
							<Item
								text={rowText(row)}
								onselect={() => void choose(row.snapshot)}
								selected={shown?.snapshot.file === row.snapshot.file}
							/>
						{/each}
					</section>
				{/each}
			{/if}
		</div>

		{#if history && history.snapshots.length > 0}
			<footer
				class="border-line text-caption text-ink-muted flex flex-wrap items-center gap-1 border-t px-3 py-2"
			>
				<span>History uses {sizeLabel(history.bytes)}</span>
				{#if old > 0}
					<span aria-hidden="true">·</span>
					<Button variant="ghost" size="sm" onclick={() => (confirmingClear = true)}>
						Clear snapshots older than 3 months
					</Button>
				{/if}
			</footer>
		{/if}
	</div>

	<div class="flex min-w-0 flex-1 flex-col">
		{#if shown}
			<div class="border-line flex items-center gap-2 border-b px-3 py-1.5">
				<p class="text-small text-ink-muted flex-1">{previewLine(shown.snapshot, now)}</p>
				<Button
					variant="primary"
					loading={restoring}
					disabled={!shown.content}
					onclick={() => void restore()}
				>
					Restore this version
				</Button>
			</div>
			{#if shown.content}
				<div class="bg-surface-sunken min-h-0 flex-1 overflow-auto p-6">
					<div bind:this={host} class="border-line mx-auto max-w-3xl border"></div>
				</div>
			{:else}
				<Banner tone="danger">
					This snapshot couldn’t be read, so it can’t be restored here. It’s kept as
					{shown.snapshot.file} in the project’s .erti/history folder.
				</Banner>
			{/if}
		{:else if history && history.snapshots.length > 0}
			<EmptyState
				message="Choose a snapshot to see it."
				detail="Nothing changes until you restore one."
			/>
		{/if}
	</div>
</section>

<ConfirmDialog
	bind:open={confirmingClear}
	title={`Clear ${snapshotCount(old)} older than 3 months?`}
	action="Clear snapshots"
	busy={clearing}
	onConfirm={clear}
>
	{#snippet consequences()}
		<p>
			They’re deleted from this document’s history, and can’t be got back. Snapshots from the last 3
			months are kept.
		</p>
	{/snippet}
</ConfirmDialog>
