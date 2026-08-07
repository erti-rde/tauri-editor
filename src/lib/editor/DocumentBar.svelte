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

<div class="flex items-center gap-1 overflow-x-auto border-b border-gray-200 px-4 py-1">
	{#each documents as document (document.path)}
		<button
			class="shrink-0 rounded-t-md border-b-2 px-3 py-1 text-sm whitespace-nowrap transition-colors
				{document.path === current?.path
				? 'border-orange-500 font-medium text-gray-900'
				: 'border-transparent text-gray-500 hover:text-gray-800'}"
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
			class="ml-1 w-40 shrink-0 rounded-md border border-orange-400 px-2 py-1 text-sm focus:outline-none"
			placeholder="Chapter one"
			aria-label="Name for the new document"
			{onkeydown}
			onblur={confirm}
		/>
	{:else}
		<button
			class="ml-1 shrink-0 rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-800"
			onclick={startNaming}
			title="New document"
		>
			+ New
		</button>
	{/if}
</div>
