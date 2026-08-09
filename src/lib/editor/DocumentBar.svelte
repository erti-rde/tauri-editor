<script lang="ts">
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
	}

	const { documents, current, onopen, oncreate }: Props = $props();

	let naming = $state(false);
	let draft = $state('');
	let input = $state<HTMLInputElement>();

	function startNaming() {
		naming = true;
		draft = '';
		// The field is created by this state change, so focus waits for it.
		queueMicrotask(() => input?.focus());
	}

	function confirm() {
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
	{/each}

	{#if naming}
		<input
			bind:this={input}
			bind:value={draft}
			class="border-accent bg-surface-raised text-ink ml-1 w-40 shrink-0 rounded border px-2 py-1 text-xs"
			placeholder="Chapter one"
			aria-label="Name for the new document"
			{onkeydown}
			onblur={confirm}
		/>
	{:else}
		<button
			class="text-ink-faint hover:bg-surface-hover hover:text-ink ml-1 shrink-0 rounded px-2 py-1 text-xs"
			onclick={startNaming}
			title="New document"
		>
			+ New
		</button>
	{/if}
</div>
