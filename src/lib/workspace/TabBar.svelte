<script lang="ts">
	import { DocumentTab } from '$lib/ui';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import FileText from '~icons/lucide/file-text';
	import FileType from '~icons/lucide/file-type-2';
	import SplitSquare from '~icons/lucide/columns-2';

	import { workspaceStore } from './workspaceStore';
	import { documentsStore } from '$lib/stores/documents.svelte';
	import { get } from 'svelte/store';
	import type { Pane, Tab, Workspace } from './tabs';

	/**
	 * One pane's open files.
	 *
	 * Reads as an editor's tab strip rather than a document switcher, because
	 * that is what it now is: a manuscript and the papers it cites sit in the
	 * same row, and either can be the thing on screen.
	 */
	interface Props {
		pane: Pane;
		workspace: Workspace;
		/** Whether this pane is the one new files open into. */
		focused: boolean;
	}

	const { pane, workspace, focused }: Props = $props();

	const canSplit = $derived(workspace.panes.length < 2 && pane.tabs.length > 0);

	/**
	 * Show a tab, and for a manuscript actually load it.
	 *
	 * Making the tab active only decides which pane shows the editor. Which
	 * manuscript the editor holds is a separate question, and one only the editor
	 * can answer — it has to save the outgoing document first — so this asks.
	 */
	function activate(tab: Tab) {
		workspaceStore.open(tab, pane.id);

		if (tab.kind !== 'document') return;

		const document = get(documentsStore).documents.find((d) => d.path === tab.id);
		if (document) documentsStore.request(document);
	}
</script>

<div
	class="border-line bg-surface-sunken flex h-8 shrink-0 items-stretch border-b"
	role="tablist"
	aria-label="Open files"
>
	<div class="flex min-w-0 grow items-stretch overflow-x-auto">
		{#each pane.tabs as tabId (tabId)}
			{@const tab = workspace.tabs[tabId]}
			{#if tab}
				<DocumentTab
					title={tab.title}
					icon={tab.kind === 'pdf' ? FileType : FileText}
					current={pane.active === tabId}
					onselect={() => activate(tab)}
					onclose={() => workspaceStore.close(pane.id, tabId)}
				/>
			{/if}
		{/each}
	</div>

	{#if canSplit}
		<Tooltip label="Split the view" side="bottom">
			{#snippet children(tooltip)}
				<button
					{...tooltip}
					class="text-ink-muted hover:bg-surface-hover hover:text-ink shrink-0 px-2 transition-colors"
					onclick={() => {
						workspaceStore.focus(pane.id);
						workspaceStore.split();
					}}
				>
					<SplitSquare class="h-3.5 w-3.5" />
				</button>
			{/snippet}
		</Tooltip>
	{/if}

	<!-- Which pane the next file opens into, shown only when there is a choice. -->
	{#if workspace.panes.length > 1}
		<div
			class="w-0.5 shrink-0 transition-colors {focused ? 'bg-accent' : 'bg-transparent'}"
			aria-hidden="true"
		></div>
	{/if}
</div>
