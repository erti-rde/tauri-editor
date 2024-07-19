<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { createDialog, melt } from '@melt-ui/svelte';
	import { fade } from 'svelte/transition';

	import { getMetadata, updateMetadata } from '$utils/api';
	import type { Citation } from '$types/citation';
	import Icon from '$lib/Icon.svelte';

	const dispatch = createEventDispatcher();
	const {
		elements: { overlay, content, title, description, close, portalled }
	} = createDialog({
		forceVisible: true,
		preventScroll: false
	});

	export let fileName: string;
	let metadata: Citation;

	getMetadata(fileName + '.pdf').then((data) => {
		if (!data.metadata.author) {
			data.metadata.author = {
				first_name: '',
				last_name: ''
			};
		}
		metadata = data.metadata;
	});

	$: sharedFields = [
		{ label: 'Title', value: metadata?.title || '', referrer: 'title' },
		{ label: 'Year', value: metadata?.year || '', referrer: 'year' }
	];

	$: additionalFields =
		metadata?.type === 'book'
			? [
					{ label: 'Edition', value: metadata?.edition || '', referrer: 'edition' },
					{ label: 'Location', value: metadata?.location || '', referrer: 'location' },
					{ label: 'Publisher', value: metadata?.publisher || '', referrer: 'publisher' }
				]
			: metadata?.type === 'journal'
				? [
						{
							label: 'Journal title',
							value: metadata?.journal_title || '',
							referrer: 'journal_title'
						},
						{ label: 'Volume', value: metadata?.volume || '', referrer: 'volume' },
						{ label: 'Issue', value: metadata?.issue || '', referrer: 'issue' },
						{ label: 'Pages', value: metadata?.pages || '', referrer: 'pages' }
					]
				: [];

	$: allFields = [...sharedFields, ...additionalFields];

	function closeForm() {
		dispatch('close');
	}

	function saveChanges() {
		updateMetadata(fileName + '.pdf', metadata);
		closeForm();
	}
</script>

<div use:melt={$portalled}>
	<div
		use:melt={$overlay}
		class="fixed inset-0 z-50 bg-black/50"
		transition:fade={{ duration: 150 }}
	/>
	<div
		class="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[90vw] max-w-[450px]
            -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl bg-white
            p-6 shadow-lg"
		transition:fade={{
			duration: 150
		}}
		use:melt={$content}
	>
		<h2 use:melt={$title} class="m-0 text-lg font-medium text-black">
			Edit <span class="bg-orange-200 px-2 py-0.5 italic">{fileName}</span> metadata.
		</h2>
		<p use:melt={$description} class="mb-5 mt-2 leading-normal text-zinc-600">
			Make metadata changes here. Fill empty fields. These are required for correct citation. Click
			save when you're done.
		</p>

		{#if metadata}
			<fieldset class="relative mb-4 flex items-center gap-5">
				<label class="w-[90px] text-right text-black" for="type">Type </label>
				<select
					name="type"
					id="type"
					class="inline-flex h-8 w-full flex-1 items-center justify-center
        rounded-sm border border-solid px-3 leading-none text-black"
					bind:value={metadata.type}
				>
					<option value="book">Book</option>
					<option value="journal">Journal</option>
				</select>
				<div class="absolute right-1 top-[50%] h-[24px] w-[24px] translate-y-[-50%]">
					<Icon icon="lucide:chevron-down" size="m" />
				</div>
			</fieldset>
			<fieldset class="mb-4 flex items-center gap-5">
				<label class="w-[90px] text-right text-black" for="first_name"> First Name </label>
				<input
					class="inline-flex h-8 w-full flex-1 items-center justify-center
                    rounded-sm border border-solid px-3 leading-none text-black"
					id="first_name"
					bind:value={metadata.author.first_name}
				/>
			</fieldset>
			<fieldset class="mb-4 flex items-center gap-5">
				<label class="w-[90px] text-right text-black" for="last_name"> Last Name </label>
				<input
					class="inline-flex h-8 w-full flex-1 items-center justify-center
                    rounded-sm border border-solid px-3 leading-none text-black"
					id="last_name"
					bind:value={metadata.author.last_name}
				/>
			</fieldset>
			{#each allFields as field}
				<fieldset class="mb-4 flex items-center gap-5">
					<label class="w-[90px] text-right text-black" for={field.label}>
						{field.label}
					</label>
					<input
						class="inline-flex h-8 w-full flex-1 items-center justify-center
                      rounded-sm border border-solid px-3 leading-none text-black"
						id={field.label}
						bind:value={metadata[field.referrer]}
					/>
				</fieldset>
			{/each}
		{/if}

		<div class="mt-6 flex justify-end gap-4">
			<button
				use:melt={$close}
				on:click={closeForm}
				class="inline-flex h-8 items-center justify-center rounded-sm
                    bg-zinc-100 px-4 font-medium leading-none text-zinc-600"
			>
				Cancel
			</button>
			<button
				on:click={saveChanges}
				use:melt={$close}
				class="inline-flex h-8 items-center justify-center rounded-sm
                    bg-orange-100 px-4 font-medium leading-none text-orange-900 disabled:opacity-50"
			>
				Save changes
			</button>
		</div>
		<button
			use:melt={$close}
			aria-label="close"
			on:click={closeForm}
			class="absolute right-4 top-4 inline-flex h-6 w-6 appearance-none
                items-center justify-center rounded-full p-1 text-orange-800
                hover:bg-orange-100 focus:shadow-orange-400"
		>
			<Icon icon="lucide:x" size="s" />
		</button>
	</div>
</div>

<style>
	select {
		appearance: none;
	}
</style>
