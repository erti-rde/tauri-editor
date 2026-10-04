<script lang="ts">
	import type { CitationItem } from '$lib/stores/citationStore';
	import { Button, DateField, Select, Sidebar, TextField } from '$lib/ui';
	import { CalendarDate } from '@internationalized/date';

	import RemoveSource from './RemoveSource.svelte';

	import type { DateValue } from '@internationalized/date';
	import type { AugmentedZoteroSchema } from './adapterCslZotero';

	interface Props {
		source: CitationItem;
		/** The row being edited: its id, what it's called, and where its PDF is. */
		record: { id: string; title: string; path: string | null };
		onclose: () => void;
		onupdate: (sourceId: string, metadata: CitationItem) => void;
		/** After it's been removed from the library. */
		onremoved: () => void;
		augmentedSchema: AugmentedZoteroSchema;
	}
	const {
		source = $bindable(),
		record,
		onclose,
		augmentedSchema,
		onupdate,
		onremoved
	}: Props = $props();

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

	/** A field's value as text; anything that isn't one yet starts empty. */
	function textOf(value: CitationItem[string]): string {
		return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
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

<Sidebar title="Edit source" subtitle={record.title} {onclose}>
	<div class="grid gap-3 p-3">
		<Select
			label="Source type"
			placeholder="Choose a source type"
			items={itemTypesFields}
			value={source.zotero_type}
			type="single"
			onValueChange={handleSourceTypeChange}
		/>
		{#if currentFormFields.length}
			{#each currentFormFields as { cslField, label, field, inputType } (field)}
				{#if cslField}
					{#if inputType === 'date'}
						{@const dateValue = getDateParts(source[cslField])}
						<DateField
							{label}
							value={dateValue
								? new CalendarDate(dateValue[0], dateValue[1], dateValue[2])
								: undefined}
							onValueChange={(value) => value && handleDateValueChange(cslField, value)}
						/>
					{:else}
						<!-- Text whatever the field: CSL's numbers are often ranges, "12–14". -->
						<TextField
							{label}
							value={textOf(source[cslField])}
							oninput={(event) => (source[cslField] = event.currentTarget.value)}
						/>
					{/if}
				{/if}
			{/each}
		{:else}
			<p class="text-small text-ink-muted">Choose a source type to see its fields.</p>
		{/if}
	</div>
	{#snippet footer()}
		<RemoveSource id={record.id} title={record.title} path={record.path} {onremoved} />
		<span class="flex-1"></span>
		<Button variant="primary" onclick={handleSave}>Save</Button>
	{/snippet}
</Sidebar>
