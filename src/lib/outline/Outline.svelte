<script lang="ts">
	import { EmptyState, PanelHeader, TreeRow } from '$lib/ui';
	import { outlineStore } from './outlineStore';

	/**
	 * The document's headings, as a way to move around it.
	 *
	 * A tree rather than a flat list, because the shape of a paper is part of
	 * what you are navigating by — "the third subsection of Methods" is how
	 * people hold a long document in their heads.
	 */

	const headings = $derived($outlineStore.headings);

	function go(pos: number) {
		$outlineStore.navigate?.(pos);
	}

	// A Tab into the tree lands on the heading you're in, or the first.
	const tabbablePos = $derived(
		headings.some((heading) => heading.pos === $outlineStore.activePos)
			? $outlineStore.activePos
			: headings[0]?.pos
	);
</script>

<nav class="bg-surface flex h-full w-full flex-col" aria-label="Document outline">
	<PanelHeader title="Outline" />

	{#if headings.length === 0}
		<!--
			Said plainly rather than left blank. An empty panel reads as something
			that failed to load; this reads as a document that has no headings yet,
			which is a fact about the manuscript and not about the app.
		-->
		<EmptyState
			message="No headings yet"
			detail="Use Heading 1, 2 or 3 and they will appear here."
		/>
	{:else}
		<!-- Flat, as the headings are: each says its depth, and none folds. -->
		<div role="tree" aria-label="Headings" class="min-h-0 grow overflow-y-auto py-1">
			{#each headings as heading (heading.pos)}
				{@const active = $outlineStore.activePos === heading.pos}
				<TreeRow
					level={heading.depth + 1}
					label={heading.text || 'Untitled section'}
					current={active}
					meta={active ? "you're here" : undefined}
					tabbable={heading.pos === tabbablePos}
					onselect={() => go(heading.pos)}
				/>
			{/each}
		</div>
	{/if}
</nav>
