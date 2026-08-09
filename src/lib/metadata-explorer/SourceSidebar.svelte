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
		onupdate: (sourceId: string, metadata: CitationItem) => void;
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

	const itemTypesFields = $derived(augmentedSchema.typeFields);

	/** CSL-JSON date fields look like `{ 'date-parts': [[yyyy, mm, dd]] }`. */
	type CslDate = { 'date-parts'?: number[][] };

	/**
	 * Only a complete [year, month, day] is usable. CSL dates are legitimately
	 * partial — a year-only book is `{ 'date-parts': [[2021]] }` — and passing
	 * the missing entries to CalendarDate yields undefined year/month/day, which
	 * throws while rendering the sidebar.
	 */
	function getDateParts(value: CitationItem[string]): [number, number, number] | undefined {
		const parts = (value as CslDate | undefined)?.['date-parts'];
		const first = Array.isArray(parts) ? parts[0] : undefined;

		if (!Array.isArray(first) || first.length < 3) return undefined;
		const [year, month, day] = first;
		if (![year, month, day].every((n) => Number.isInteger(n))) return undefined;

		return [year, month, day];
	}

	function handleSave() {
		onupdate(String(source.id), source);
	}

	function handleSourceTypeChange(value: string) {
		source.zotero_type = value;
		source.type = augmentedSchema.zoteroToCslTypeMap.get(value) || '';
	}

	function handleDateValueChange(fieldName: string, value: DateValue) {
		if (value.year && value.month && value.day) {
			let editedDate = [value.year, value.month, value.day];
			const existing = source[fieldName] as CslDate | undefined;
			source[fieldName] = existing
				? { ...existing, 'date-parts': [editedDate] }
				: { 'date-parts': [editedDate] };
		}
	}
</script>

<div
	class="border-line bg-surface-raised fixed top-0 right-0 z-10 h-full w-[400px] overflow-auto border-l shadow-lg"
	transition:fly={{ x: 400, duration: 300 }}
>
	<div
		class="border-line bg-surface-raised sticky top-0 z-20 flex items-center justify-between border-b px-4 py-3"
	>
		<h3 class="text-lg font-bold">Edit Source</h3>
		<div>
			<button
				class="bg-accent text-accent-ink hover:bg-accent-hover mr-2 rounded px-3 py-1"
				onclick={handleSave}
			>
				Save
			</button>
			<button
				class="hover:bg-surface-hover focus-visible:ring-accent rounded-full p-1 focus-visible:ring-2"
				aria-label="Close source details"
				onclick={onclose}
			>
				<Icon icon="X" class="h-5 w-5" />
			</button>
		</div>
	</div>
	<div class="p-4">
		<div class="mb-4">
			<label class="text-ink mb-1 block text-sm font-medium">
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
								{@const dateValue = getDateParts(source[cslField])}
								<!-- Date input -->
								<DateField
									labelText={label}
									value={dateValue
										? new CalendarDate(dateValue[0], dateValue[1], dateValue[2])
										: undefined}
									onValueChange={(value) => value && handleDateValueChange(cslField, value)}
								/>
							{:else}
								<label class="text-ink mb-1 block text-sm font-medium">
									{label}
									<input
										type={inputType}
										class="border-line-strong w-full rounded-md border p-2"
										bind:value={source[cslField]}
										oninput={(event) => (source[cslField] = event.currentTarget.value)}
									/>
								</label>
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		{:else}
			<div class="text-ink-muted italic">Select a source type to see available fields</div>
		{/if}
	</div>
</div>
