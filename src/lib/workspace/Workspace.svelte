<script lang="ts">
	import Editor from '$lib/editor/Editor.svelte';
	import PdfReader from '$lib/pdfreader/PdfReader.svelte';

	import { documentsStore } from '$lib/stores/documents.svelte';
	import { SplitHandle } from '$lib/ui';

	import TabBar from './TabBar.svelte';
	import { workspaceStore } from './workspaceStore';
	import { activeTab } from './tabs';
	import { EVEN, readShare, saveShare, shareLimits } from './split';

	/**
	 * The panes, side by side.
	 *
	 * The window used to show one thing, chosen by a mode flag: opening a PDF
	 * replaced the manuscript and getting back meant finding the file again. A
	 * researcher reads a paper and writes about it at the same time, so that was
	 * the one arrangement the application could not make.
	 *
	 * Two panes at most, split vertically. Three columns of prose on a laptop is
	 * not reading, and the second pane is there to hold a paper open beside the
	 * writing rather than to tile the screen.
	 */

	/** The first pane's share of the width, as this window last had it (M5-9). */
	let share = $state(EVEN);
	let width = $state(0);
	/** Moved before the saved share arrived, so it isn't put back over the move. */
	let moved = false;

	const limits = $derived(shareLimits(width));
	const shown = $derived(Math.min(limits.max, Math.max(limits.min, share)));

	$effect(() => {
		readShare()
			.then((saved) => {
				if (!moved) share = saved;
			})
			// Unread, the split starts even, as it always did.
			.catch(() => {});
	});

	function chosen(next: number) {
		moved = true;
		saveShare(next).catch(() => {});
	}

	/**
	 * The manuscript always has a tab.
	 *
	 * Which manuscript is a question `documentsStore` already answers — and the
	 * document bar inside the editor is what changes the answer. This mirrors it
	 * into the workspace so the writing appears in the same row as the papers,
	 * rather than the editor being an untabbed backdrop the tabs sit on.
	 */
	$effect(() => {
		const current = $documentsStore.current;
		if (!current) return;

		const open = Object.values($workspaceStore.tabs).find((t) => t.kind === 'document');
		// Retitled in place when the document changes, so switching chapters does
		// not leave a row of stale manuscript tabs behind.
		if (open && open.id !== current.path) {
			workspaceStore.rename(open.id, { id: current.path, title: current.title });
			return;
		}

		if (!open) workspaceStore.open({ id: current.path, kind: 'document', title: current.title });
	});
</script>

<div class="flex h-full w-full min-w-0" bind:clientWidth={width}>
	{#each $workspaceStore.panes as pane, index (pane.id)}
		{#if index > 0}
			<SplitHandle
				label="Resize the split"
				bind:value={share}
				min={limits.min}
				max={limits.max}
				reset={EVEN}
				onchange={chosen}
			/>
		{/if}

		<div
			class="flex min-w-0 grow basis-0 flex-col"
			style:flex-grow={$workspaceStore.panes.length < 2 ? 1 : index === 0 ? shown : 1 - shown}
			onfocusincapture={() => workspaceStore.focus(pane.id)}
			onpointerdowncapture={() => workspaceStore.focus(pane.id)}
		>
			<TabBar {pane} workspace={$workspaceStore} focused={pane.id === $workspaceStore.focused} />

			<div class="min-h-0 grow">
				{#if pane.active}
					{@const tab = activeTab($workspaceStore, pane.id)}
					{#if tab?.kind === 'pdf'}
						<!-- Keyed by path: a new PDF is a new reader rather than the same
						     one asked to forget everything it had loaded. -->
						{#key tab.id}
							<PdfReader path={tab.id} paneId={pane.id} />
						{/key}
					{:else if tab}
						<Editor />
					{/if}
				{:else}
					<div
						class="text-ink-muted flex h-full items-center justify-center p-8 text-center text-xs"
					>
						<p>
							Nothing open here.<br />
							Choose a paper or a document in the explorer.
						</p>
					</div>
				{/if}
			</div>
		</div>
	{/each}
</div>
