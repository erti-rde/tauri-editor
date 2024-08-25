<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { Icon } from '$lib';
	import { getMetadata, deleteMetadata } from '$utils/api';
	import { validateCitationFields } from '$types/citation';
	import MetaDataForm from './MetadataFrom.svelte';

	export let fileName: string;
	const dispatch = createEventDispatcher();
	let showMetadataForm = false;

	function editMetadata() {
		showMetadataForm = true;
	}

	async function deleteSource(fileName: string) {
		await deleteMetadata(fileName + '.pdf');
		dispatch('sourceDeleted');
	}

	async function checkMetaData(fileName: string) {
		const { metadata } = await getMetadata(fileName + '.pdf');
		const keys = Object.keys(metadata);

		let completed = false;
		if (!keys.includes('type')) {
			completed = false;
		} else {
			completed = validateCitationFields(metadata);
		}
		return {
			fileName,
			metadata,
			completed
		};
	}

	const promise = checkMetaData(fileName);
</script>

<div class="relative flex">
	{#await promise then data}
		{#if data.completed}
			<div class="edit-delete-icons">
				<button class="w-[20px]" on:click={() => editMetadata()}>
					<Icon icon="Pencil" size="s" />
				</button>
				<button class="w-[20px]" on:click={() => deleteSource(fileName)}>
					<Icon icon="Trash" size="s" />
				</button>
			</div>
		{:else}
			<button class="w-[20px]" on:click={() => editMetadata()}>
				<Icon icon="FileWarning" size="s" />
			</button>
			<button class="w-[20px]" on:click={() => deleteSource(fileName)}>
				<Icon icon="Trash" size="s" />
			</button>
		{/if}
		{#if showMetadataForm}
			<MetaDataForm {fileName} on:close={() => (showMetadataForm = false)} />
		{/if}
	{/await}
</div>
