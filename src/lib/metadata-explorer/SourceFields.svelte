<script lang="ts">
	import X from '~icons/lucide/x';

	import { Button, IconButton, Select, TextField } from '$lib/ui';

	import type { AugmentedZoteroItemType, AugmentedZoteroSchema } from './adapterCslZotero';
	import type { FormValues } from './cslForm';
	import { isRequired, typeChoices } from './sourceForm';

	/**
	 * A source's details as a form (M1b-5, UX-2): its kind first, then the
	 * fields that kind has, required ones marked, then who wrote or edited it.
	 * Everything is text here; `cslForm.ts` turns it into CSL and back.
	 */
	interface Props {
		schema: AugmentedZoteroSchema;
		/** Undefined until a kind is chosen. */
		type: AugmentedZoteroItemType | undefined;
		form: FormValues;
		/** What's wrong, by Zotero field: shown once a save has been tried. */
		errors?: Record<string, string>;
		onTypeChange: (itemType: string) => void;
	}

	let { schema, type, form = $bindable(), errors = {}, onTypeChange }: Props = $props();

	const choices = $derived(typeChoices(schema));
	const fields = $derived(type?.fields.filter((f) => f.cslField) ?? []);
	const roles = $derived(
		(type?.creatorTypes ?? [])
			.filter((r) => r.cslVariable)
			.map((r) => ({ value: r.creatorType, label: r.label }))
	);
	const firstRole = $derived(
		type?.creatorTypes.find((r) => r.primary)?.creatorType ?? roles[0]?.value
	);

	const labelOf = (field: { field: string; label: string }) =>
		type && isRequired(type.itemType, field.field) ? `${field.label} (required)` : field.label;

	function addName(organisation: boolean) {
		if (!firstRole) return;
		form.creators.push(
			organisation
				? { creatorType: firstRole, literal: '' }
				: { creatorType: firstRole, family: '', given: '' }
		);
	}
</script>

<div class="grid gap-3 p-3">
	<Select
		label="Kind of source"
		placeholder="Choose what it is"
		items={choices}
		value={form.itemType}
		type="single"
		onValueChange={onTypeChange}
	/>

	{#if type}
		{#each fields as field (field.field)}
			<TextField
				label={labelOf(field)}
				hint={field.inputType === 'date' ? 'Year, or year-month-day: 1982, 2017-06-12' : undefined}
				error={errors[field.field]}
				type={field.inputType === 'url' ? 'url' : 'text'}
				bind:value={form.fields[field.field]}
			/>
		{/each}

		{#if roles.length}
			<fieldset class="grid gap-2">
				<legend class="text-small text-ink mb-1 font-medium">Names</legend>
				{#each form.creators as creator, i (i)}
					<div class="border-line grid gap-2 rounded border p-2">
						<div class="flex items-end gap-2">
							<div class="flex-1">
								<Select
									label="Role"
									items={roles}
									value={creator.creatorType}
									type="single"
									onValueChange={(role) => (creator.creatorType = role)}
								/>
							</div>
							<IconButton
								label="Remove this name"
								icon={X}
								onclick={() => form.creators.splice(i, 1)}
							/>
						</div>
						{#if creator.literal !== undefined}
							<TextField label="Organisation" bind:value={creator.literal} />
						{:else}
							<TextField label="Family name" bind:value={creator.family} />
							<TextField label="Given names" bind:value={creator.given} />
						{/if}
					</div>
				{/each}
				<div class="flex gap-2">
					<Button size="sm" onclick={() => addName(false)}>Add a person</Button>
					<Button size="sm" onclick={() => addName(true)}>Add an organisation</Button>
				</div>
			</fieldset>
		{/if}
	{:else}
		<p class="text-small text-ink-muted">Choose what it is to see its fields.</p>
	{/if}
</div>
