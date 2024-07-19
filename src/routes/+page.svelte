<script lang="ts">
	import { SourceSideBar, Editor } from '$lib';
	import StatusBar from '$lib/statusBar/StatusBar.svelte';
	// import { findSimilarSentences } from '$utils/api';

	// import type { responseDetails } from '$utils/api';

	// let query = '';
	// let similarSentences: responseDetails[] = [];

	// async function handleQuery() {
	// 	similarSentences = await findSimilarSentences(query);
	// }
</script>

<div class="flex h-[90vh]">
	<SourceSideBar />
	<div class="mr-[10px] flex w-full px-4 py-2">
		<!-- <div class="flex justify-evenly px-4 py-2">
			<textarea
				class="rouned w-[80%] border-2 border-orange-300 bg-orange-50 pt-4"
				placeholder="Find your cite"
				bind:value={query}
			/>
			<button class="rounded bg-orange-300 px-6 py-2" on:click={handleQuery}>Find</button>
		</div>
		<div> -->
		<Editor />
		<!-- {#if similarSentences.length > 0}
				<div>
					<h2>We found following similarities:</h2>
					{#each similarSentences as sentence}
						<ResultCard metadata={sentence} />
					{/each}
				</div>
			{:else}
				<h2>Results will be shown here:</h2>
			{/if} -->
		<!-- </div> -->
	</div>
</div>

<StatusBar />
