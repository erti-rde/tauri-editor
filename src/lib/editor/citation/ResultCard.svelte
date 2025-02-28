<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { CitationItem } from '$lib/stores/citationStore';
	import { Icon } from '$lib';
	import { citationStore } from '$lib/stores/citationStore';

	export let metadata: {
		similarity: number;
		sentence: string;
		page: number;
		metadata: CitationItem;
	};
	const dispatch = createEventDispatcher();
	function generateCitation() {
		const inlineCitation = citationStore.getInlineCitation(metadata.metadata.id);

		dispatch('select', {
			citation: {
				inlineCitation
			}
		});
	}
</script>

<div>
	<div class="mb-[10px]">
		<div class="br-bottom flex flex-col">
			<div class="flex justify-around">
				<span class="inline-block bg-orange-100 px-5 py-4"
					>{Math.round(metadata.similarity * 100)}</span
				>
				<span class="inline-block bg-orange-50 px-5 py-4">{metadata.metadata.title}</span>
				<button
					class="inline-block cursor-pointer bg-orange-300 px-5 py-4"
					on:click={generateCitation}
				>
					<Icon icon="Quote" size="l" />
				</button>
			</div>
			<div class="flex grow flex-col justify-between px-5 py-4">
				<p class="italic">{metadata.sentence}</p>
			</div>
		</div>
	</div>
</div>

<style>
	.br-bottom {
		border-top: 1px solid theme('colors.orange.200');
		border-bottom: 1px solid theme('colors.orange.200');
	}
	button {
		margin: 10px 0;
	}
</style>
