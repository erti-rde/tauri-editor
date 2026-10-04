<script lang="ts">
	import { describeError } from '$lib/ipc';
	import { addSourceByHand, setMetadataOverride } from '$lib/stores/db';
	import { errorToast, successToast } from '$lib/toast/Toast.svelte';
	import { Button, Sidebar } from '$lib/ui';

	import type { AugmentedZoteroSchema } from './adapterCslZotero';
	import { fromForm, toForm, type CslItem, type FormValues } from './cslForm';
	import RemoveSource from './RemoveSource.svelte';
	import SourceFields from './SourceFields.svelte';
	import { itemTypeOf, missing, newSourceId } from './sourceForm';

	/**
	 * A source's details, to correct (UX-3), or a new one's, to enter by hand
	 * (M1b-5, UX-2). Without a `record` it's creating.
	 */
	interface Props {
		schema: AugmentedZoteroSchema;
		record?: {
			id: string;
			/** What the researcher calls it: its title, or the file's name. */
			title: string;
			csl: CslItem | null;
			zoteroType: string | null;
		};
		onclose: () => void;
		onsaved: () => void;
		onremoved: () => void | Promise<void>;
	}

	let { schema, record, onclose, onsaved, onremoved }: Props = $props();

	const typeNamed = (itemType: string | undefined) =>
		schema.itemTypes.find((t) => t.itemType === itemType && t.cslType);

	/**
	 * Everything typed so far, beyond what the form shows: switching kind and
	 * back keeps every value, because what the new kind has no field for stays
	 * here. For showing only: saving writes over the source as it was, so a
	 * value typed under a kind that was then left isn't stored out of sight.
	 */
	// svelte-ignore state_referenced_locally
	let draft: CslItem = structuredClone($state.snapshot(record?.csl ?? {})) as CslItem;
	// svelte-ignore state_referenced_locally
	let type = $state(typeNamed(itemTypeOf(record?.zoteroType, record?.csl ?? null, schema)));
	// svelte-ignore state_referenced_locally
	let form: FormValues = $state(
		type ? toForm(draft, type) : { itemType: '', fields: {}, creators: [] }
	);
	let tried = $state(false);
	let saving = $state(false);
	const errors = $derived(tried && type ? missing(form, type) : {});

	function changeType(itemType: string) {
		if (type) draft = fromForm(form, type, draft);
		type = typeNamed(itemType);
		if (type) form = toForm(draft, type);
	}

	async function save() {
		tried = true;
		if (!type || Object.keys(missing(form, type)).length) return;
		const original = structuredClone($state.snapshot(record?.csl ?? {})) as CslItem;
		const item: CslItem = { ...fromForm(form, type, original), zotero_type: type.itemType };
		saving = true;
		try {
			if (record) {
				// A project-local correction: the library's copy, and every other
				// project citing it, are left alone.
				await setMetadataOverride(record.id, JSON.stringify(item));
			} else {
				const id = newSourceId();
				await addSourceByHand(id, JSON.stringify({ ...item, id }), type.itemType);
				successToast(`Added “${String(item.title)}” to your library and this project.`);
			}
			onsaved();
		} catch (error) {
			errorToast(`Could not save it: ${describeError(error)}`);
		} finally {
			saving = false;
		}
	}
</script>

<Sidebar
	title={record ? 'Edit source' : 'New source'}
	subtitle={record?.title ?? 'Entered by hand, with no file'}
	{onclose}
>
	<SourceFields {schema} {type} bind:form {errors} onTypeChange={changeType} />
	{#snippet footer()}
		{#if record}
			<RemoveSource id={record.id} title={record.title} csl={record.csl} {onremoved} />
		{/if}
		<span class="flex-1"></span>
		<Button variant="primary" loading={saving} disabled={!type} onclick={save}>
			{record ? 'Save' : 'Add to library'}
		</Button>
	{/snippet}
</Sidebar>
