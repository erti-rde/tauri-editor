<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { Icon } from '$lib';
	import { getMetadata, deleteMetadata } from '$utils/api';
	import { validateCitationFields } from '$types/citation';
	import MetaDataForm from './MetadataFrom.svelte';

	export let name: string;
	const dispatch = createEventDispatcher();
	let showMetadataForm = false;

	function editMetadata() {
		showMetadataForm = true;
	}

	async function deleteSource(name: string) {
		await deleteMetadata(name + '.pdf');
		dispatch('sourceDeleted');
	}

	async function checkMetaData(name: string) {
		const { metadata } = await getMetadata(name + '.pdf');
		const keys = Object.keys(metadata);

		let completed = false;
		if (!keys.includes('type')) {
			completed = false;
		} else {
			completed = validateCitationFields(metadata);
		}
		return {
			name,
			metadata,
			completed
		};
	}

	const promise = checkMetaData(name);
</script>

<div class="relative flex">
	{#await promise then data}
		{#if data.completed}
			<div class="edit-delete-icons">
				<button class="w-[20px]" on:click={() => editMetadata()}>
					<Icon icon="Pencil" size="s" />
				</button>
				<button class="w-[20px]" on:click={() => deleteSource(name)}>
					<Icon icon="Trash" size="s" />
				</button>
			</div>
		{:else}
			<button class="w-[20px]" on:click={() => editMetadata()}>
				<Icon icon="FileWarning" size="s" />
			</button>
			<button class="w-[20px]" on:click={() => deleteSource(name)}>
				<Icon icon="Trash" size="s" />
			</button>
		{/if}
		{#if showMetadataForm}
			<MetaDataForm {name} on:close={() => (showMetadataForm = false)} />
		{/if}
	{/await}
</div>
