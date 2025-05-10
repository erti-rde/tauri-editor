<script lang="ts">
	import { fly } from 'svelte/transition';
	import { Icon } from '$lib';
	import type { CitationItem } from '$lib/stores/citationStore';
	import Select from '$ui/form/Select.svelte';
	import DateField from '$ui/form/DateField.svelte';
	import { CalendarDate } from '@internationalized/date';

	import type { DateValue } from '@internationalized/date';
	import type { AugmentedZoteroSchema } from './adapterCslZotero';

	interface Props {
		source: CitationItem;
		onclose: () => void;
		onupdate: (sourceId: number, metadata: CitationItem) => void;
		augmentedSchema: AugmentedZoteroSchema;
	}
	const { source = $bindable(), onclose, augmentedSchema, onupdate }: Props = $props();

	const currentFormFields = $derived.by(() => {
		return (
			augmentedSchema.itemTypes.filter((item) => {
				return item.cslType && item.itemType === source.zotero_type;
			})[0]?.fields || []
		);
	});

	const itemTypesFields = augmentedSchema.typeFields;

	function handleSave() {
		onupdate(+source.id, source);
	}

	function handleSourceTypeChange(value: string) {
		source.zotero_type = value;
		source.type = augmentedSchema.zoteroToCslTypeMap.get(value) || '';
	}

	function handleDateValueChange(fieldName: string, value: DateValue) {
		if (value.year && value.month && value.day) {
			let editedDate = [value.year, value.month, value.day];
			source[fieldName] = source[fieldName]
				? { ...source[fieldName], 'date-parts': [editedDate] }
				: { 'date-parts': [editedDate] };
		}
	}
</script>

<div
	class="fixed top-0 right-0 z-10 h-full w-[400px] overflow-auto border-l border-gray-200 bg-white shadow-lg"
	transition:fly={{ x: 400, duration: 300 }}
>
	<div
		class="sticky top-0 z-20 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3"
	>
		<h3 class="text-lg font-bold">Edit Source</h3>
		<div>
			<button
				class="mr-2 rounded bg-orange-500 px-3 py-1 text-white hover:bg-orange-600"
				onclick={handleSave}
			>
				Save
			</button>
			<button class="rounded-full p-1 hover:bg-gray-100" onclick={onclose}>
				<Icon icon="X" class="h-5 w-5" />
			</button>
		</div>
	</div>
	<div class="p-4">
		<div class="mb-4">
			<label class="mb-1 block text-sm font-medium text-gray-700">
				Source Type
				<Select
					placeholder="Select Source type"
					items={itemTypesFields}
					value={source.zotero_type}
					type="single"
					onValueChange={handleSourceTypeChange}
				/>
			</label>
		</div>
		{#if currentFormFields}
			<!-- Render form fields based on selected type -->
			<div class="space-y-4">
				{#each currentFormFields as { cslField, label, field, inputType } (field)}
					{#if cslField}
						<div class="mb-4">
							{#if inputType === 'date'}
								{@const dateValue: number[] = source[cslField]?.['date-parts'][0]}
								<!-- Date input -->
								<DateField
									labelText={label}
									value={dateValue && new CalendarDate(...dateValue)}
									onValueChange={(value) => handleDateValueChange(cslField, value)}
								/>
							{:else}
								<label class="mb-1 block text-sm font-medium text-gray-700">
									{label}
									<input
										type={inputType}
										class="w-full rounded-md border border-gray-300 p-2"
										bind:value={source[cslField]}
										oninput={(event) => (source[cslField] = event.target.value)}
									/>
								</label>
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		{:else}
			<div class="text-gray-500 italic">Select a source type to see available fields</div>
		{/if}
	</div>
</div>
