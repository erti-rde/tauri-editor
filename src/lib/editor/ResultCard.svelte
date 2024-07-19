<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import {
		generateHarvardCitation,
		generateHarvardInTextCitation
	} from '../../utils/formaters/harvardStyle';
	import type { Citation } from '$types/citation';
	import { Icon } from '$lib';
	import { InlineCitation } from './Citation';

	export let metadata: {
		similarity: number;
		sentence: string;
		page: number;
		metadata: Citation;
	};
	const sourceMetadata = metadata.metadata;
	const citationMetadata: Citation = {
		type: sourceMetadata.type as Citation['type'],
		author: {
			first_name: sourceMetadata.author.first_name,
			last_name: sourceMetadata.author.last_name
		},
		title: sourceMetadata.title,
		year: sourceMetadata.year,
		publisher: sourceMetadata.publisher,
		location: sourceMetadata.location,
		edition: sourceMetadata.edition,
		articleTitle: sourceMetadata.articleTitle,
		journalTitle: sourceMetadata.journalTitle,
		volume: sourceMetadata.volume,
		issue: sourceMetadata.issue,
		pages: sourceMetadata.pages
	};

	// function handleFullReferencing() {
	// 	navigator.clipboard.writeText(generateHarvardCitation(citationMetadata));
	// }

	// function handleInTextCitation() {
	// 	navigator.clipboard.writeText(
	// 		generateHarvardInTextCitation(citationMetadata, metadata.page.toString())
	// 	);
	// }
	const dispatch = createEventDispatcher();
	function generateCitation() {
		const inlineCitation = generateHarvardInTextCitation(
			citationMetadata,
			metadata.page.toString()
		);
		const fullCitation = generateHarvardCitation(citationMetadata);
		dispatch('select', {
			citation: {
				inlineCitation,
				fullCitation
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
				<span class="inline-block bg-orange-50 px-5 py-4"
					>{metadata.metadata.title} - {metadata.metadata.author.first_name}
					{metadata.metadata.author.last_name}</span
				>
				<span
					class="inline-block cursor-pointer bg-orange-300 px-5 py-4"
					on:click={generateCitation}
				>
					<Icon icon="lucide:quote" size="l" />
				</span>
			</div>
			<div class="flex grow flex-col justify-between px-5 py-4">
				<p class="italic">{metadata.sentence}</p>
			</div>
			<!-- <div class="mb-[10px] mt-[10px]">
				<div class="flex w-[150px] flex-col">
					<button class="rounded bg-orange-300 px-2 py-1" on:click={handleFullReferencing}
						>Full cite</button
					>
					<button class="rounded bg-orange-300 px-2 py-1" on:click={handleInTextCitation}
						>In-text cite</button
					>
				</div>
			</div> -->
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
