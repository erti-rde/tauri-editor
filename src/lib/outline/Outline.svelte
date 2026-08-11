<script lang="ts">
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
</script>

<nav class="bg-surface flex h-full w-full flex-col" aria-label="Document outline">
	<h2
		class="text-ink-muted border-line shrink-0 border-b px-3 py-2 text-[11px] font-medium tracking-wide uppercase"
	>
		Outline
	</h2>

	{#if headings.length === 0}
		<!--
			Said plainly rather than left blank. An empty panel reads as something
			that failed to load; this reads as a document that has no headings yet,
			which is a fact about the manuscript and not about the app.
		-->
		<p class="text-ink-muted px-3 py-3 text-xs">
			No headings yet. Use Heading 1, 2 or 3 and they will appear here.
		</p>
	{:else}
		<ul class="min-h-0 grow overflow-y-auto py-1">
			{#each headings as heading (heading.pos)}
				{@const active = $outlineStore.activePos === heading.pos}
				<li>
					<button
						type="button"
						class="hover:bg-surface-hover focus-visible:ring-accent block w-full truncate px-3 py-1 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:ring-inset
							{active ? 'bg-accent-quiet text-ink font-medium' : 'text-ink-muted'}"
						style="padding-left: {12 + heading.depth * 14}px"
						aria-current={active ? 'location' : undefined}
						onclick={() => go(heading.pos)}
					>
						{heading.text || 'Untitled section'}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</nav>
