<script lang="ts">
	import Copy from '~icons/lucide/copy';
	import FileText from '~icons/lucide/file-text';
	import History from '~icons/lucide/history';
	import Pencil from '~icons/lucide/pencil';
	import Trash from '~icons/lucide/trash-2';

	import { Button, ConfirmDialog, DocumentTab, InlineRename, type MenuItem } from '$lib/ui';

	import { toDocumentFileName, type ProjectDocument } from './documents';

	/**
	 * Which manuscript is open, and how to reach the others.
	 *
	 * A project used to hold exactly one piece of writing, so there was nothing
	 * to show. A thesis has chapters and a paper has a draft alongside a response
	 * to reviewers, so the set has to be visible and one click away.
	 *
	 * The open one's ⋯ menu holds what's done to a document as a whole (UX-9):
	 * renamed in its tab, duplicated, its history, and deleted after asking.
	 */

	interface Props {
		documents: ProjectDocument[];
		current: ProjectDocument | null;
		onopen: (document: ProjectDocument) => void;
		oncreate: (name: string) => void;
		/** Show the open document's history (UX-9). */
		onhistory: () => void;
		/** Rename the open document; the name has passed `toDocumentFileName`. */
		onrename?: (name: string) => void;
		onduplicate?: () => void;
		/** Move the open document to the bin, once the writer has said so. */
		ondelete?: () => Promise<void>;
	}

	const {
		documents,
		current,
		onopen,
		oncreate,
		onhistory,
		onrename,
		onduplicate,
		ondelete
	}: Props = $props();

	let naming = $state(false);
	let renaming = $state(false);
	let confirming = $state(false);
	let deleting = $state(false);
	/** Kept while the dialog closes, when another document is already current. */
	let doomed = $state('');

	/** Why a name can't be used, said as the writer types it. */
	function reasonAgainst(name: string, except?: ProjectDocument) {
		const others = documents.filter((d) => d.path !== except?.path).map((d) => d.fileName);
		return toDocumentFileName(name, others).reason;
	}

	const menu = $derived<MenuItem[]>([
		...(onrename ? [{ label: 'Rename…', icon: Pencil, onSelect: () => (renaming = true) }] : []),
		...(onduplicate ? [{ label: 'Duplicate', icon: Copy, onSelect: onduplicate }] : []),
		{ label: 'History…', icon: History, onSelect: onhistory },
		...(ondelete ? [{ label: 'Delete…', icon: Trash, danger: true, onSelect: askToDelete }] : [])
	]);

	function askToDelete() {
		doomed = current?.title ?? '';
		confirming = true;
	}

	async function confirmDelete() {
		deleting = true;
		try {
			await ondelete?.();
		} finally {
			deleting = false;
			confirming = false;
		}
	}
</script>

<div
	class="border-line bg-surface-sunken flex h-8 items-stretch overflow-x-auto border-b"
	role="tablist"
	aria-label="Documents"
>
	{#each documents as document (document.path)}
		{@const isCurrent = document.path === current?.path}
		<DocumentTab
			title={document.title}
			icon={FileText}
			current={isCurrent}
			onselect={() => onopen(document)}
			menu={isCurrent ? menu : undefined}
			renaming={isCurrent && renaming}
			validate={(name) => reasonAgainst(name, document)}
			onrename={(name) => {
				renaming = false;
				onrename?.(name);
			}}
			oncancelrename={() => (renaming = false)}
		/>
	{/each}

	<div class="flex shrink-0 items-center px-1">
		{#if naming}
			<!-- Focused as it appears: the field exists because "+ New" was pressed. -->
			<InlineRename
				value=""
				label="Name for the new document"
				placeholder="Chapter one"
				class="w-40"
				validate={(name) => reasonAgainst(name)}
				oncommit={(name) => {
					naming = false;
					oncreate(name);
				}}
				oncancel={() => (naming = false)}
			/>
		{:else}
			<Button variant="ghost" size="sm" onclick={() => (naming = true)} title="New document">
				+ New
			</Button>
		{/if}
	</div>
</div>

{#if ondelete}
	<ConfirmDialog
		bind:open={confirming}
		title="Delete “{doomed}”?"
		action="Delete"
		busy={deleting}
		onConfirm={confirmDelete}
	>
		{#snippet consequences()}
			<p>It moves to the bin, and can be put back from there.</p>
			<p class="text-ink-muted">
				Its history stays with the project. Put it back, or make a document of the same name, and
				History has every snapshot.
			</p>
		{/snippet}
	</ConfirmDialog>
{/if}
