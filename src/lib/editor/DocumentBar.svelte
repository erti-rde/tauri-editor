<script lang="ts">
	import Ellipsis from '~icons/lucide/ellipsis';
	import History from '~icons/lucide/history';

	import { Button, Menu, TextField } from '$lib/ui';

	import type { ProjectDocument } from './documents';

	/**
	 * Which manuscript is open, and how to reach the others.
	 *
	 * A project used to hold exactly one piece of writing, so there was nothing
	 * to show. A thesis has chapters and a paper has a draft alongside a response
	 * to reviewers, so the set has to be visible and one click away.
	 */

	interface Props {
		documents: ProjectDocument[];
		current: ProjectDocument | null;
		onopen: (document: ProjectDocument) => void;
		oncreate: (name: string) => void;
		/** Show the open document's history (UX-9). */
		onhistory: () => void;
	}

	const { documents, current, onopen, oncreate, onhistory }: Props = $props();

	let naming = $state(false);
	let draft = $state('');

	function startNaming() {
		naming = true;
		draft = '';
	}

	/**
	 * Name the new document, once.
	 *
	 * Enter and Escape end naming, which removes the field, and the browser then
	 * blurs it on its way out. Without the check that blur confirmed again: Enter
	 * created the document twice ("File exists" the second time), and Escape
	 * created the one it meant to cancel.
	 */
	function confirm() {
		if (!naming) return;
		const name = draft.trim();
		if (name.length > 0) oncreate(name);
		naming = false;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			confirm();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			naming = false;
		}
	}
</script>

<div class="border-line bg-surface flex items-center gap-px overflow-x-auto border-b px-2">
	{#each documents as document (document.path)}
		<button
			class="document-tab shrink-0 border-b-2 px-3 text-xs whitespace-nowrap transition-colors
				{document.path === current?.path
				? 'border-accent bg-surface-raised text-ink'
				: 'text-ink-muted hover:bg-surface-hover hover:text-ink border-transparent'}"
			onclick={() => onopen(document)}
			aria-current={document.path === current?.path ? 'page' : undefined}
		>
			{document.title}
		</button>
		{#if document.path === current?.path}
			<!-- The open document's own menu, beside its tab (UX-9). Rename,
			     Duplicate and Delete join History here (M5-7). -->
			<Menu
				label={`Document menu for ${document.title}`}
				items={[{ label: 'History…', icon: History, onSelect: onhistory }]}
			>
				{#snippet trigger()}
					<Ellipsis class="size-4" aria-hidden="true" />
				{/snippet}
			</Menu>
		{/if}
	{/each}

	{#if naming}
		<div class="ml-1 w-40 shrink-0">
			<!-- Focused as it appears: the field exists because "+ New" was pressed. -->
			<TextField
				bind:value={draft}
				label="Name for the new document"
				hideLabel
				placeholder="Chapter one"
				autofocus
				{onkeydown}
				onblur={confirm}
			/>
		</div>
	{:else}
		<Button variant="ghost" size="sm" class="ml-1" onclick={startNaming} title="New document">
			+ New
		</Button>
	{/if}
</div>
