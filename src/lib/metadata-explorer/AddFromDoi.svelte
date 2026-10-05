<script lang="ts">
	import { describeError } from '$lib/ipc';
	import { networkAllowed } from '$lib/stores/consent';
	import { errorToast } from '$lib/toast/Toast.svelte';
	import { Banner, Button, Dialog, TextField } from '$lib/ui';

	import type { AugmentedZoteroSchema } from './adapterCslZotero';
	import { addFromDoi, type FromDoi } from './fromDoi';

	/**
	 * Sources › Add › From a DOI… (M1b-6, docs/ux.md UX-2): a single field.
	 * Looked up at doi.org when lookups are on; otherwise it says so and offers
	 * the details to enter by hand, with the DOI filled in.
	 */
	interface Props {
		open?: boolean;
		schema: AugmentedZoteroSchema;
		/** Added, or found in the library already: the source to open. */
		onsource: (found: Extract<FromDoi, { kind: 'added' | 'existing' }>) => void;
		/** The details to enter by hand, starting from this DOI. */
		onbyhand: (doi: string) => void;
	}

	let { open = $bindable(false), schema, onsource, onbyhand }: Props = $props();

	let value = $state('');
	/** Whether lookups are on; null until asked. */
	let online: boolean | null = $state(null);
	let busy = $state(false);
	let notADoi = $state(false);
	/** The DOI doi.org had nothing for. */
	let missing: string | null = $state(null);
	let body: HTMLElement | undefined = $state();

	$effect(() => {
		if (!open) return;
		value = '';
		notADoi = false;
		missing = null;
		// Asked each time: lookups may have been turned on in Settings since.
		networkAllowed().then((allowed) => (online = allowed));
	});

	async function submit(lookUp: boolean) {
		if (busy || online === null || !value.trim()) return;
		notADoi = false;
		busy = true;
		try {
			const found = await addFromDoi(value, schema, { lookUp: lookUp && online });
			if (found.kind === 'not-a-doi') {
				notADoi = true;
			} else if (found.kind === 'not-found') {
				missing = found.doi;
			} else {
				open = false;
				if (found.kind === 'by-hand') onbyhand(found.doi);
				else onsource(found);
			}
		} catch (error) {
			errorToast(`Could not add it: ${describeError(error)}`);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog
	bind:open
	size="sm"
	title="Add from a DOI"
	description={online === false
		? 'Online lookups are off.'
		: 'Erti looks up its details at doi.org.'}
	dismissible={!busy}
	onOpenAutoFocus={(event) => {
		// The field, not the close button: there's one thing to do here.
		event.preventDefault();
		body?.querySelector('input')?.focus();
	}}
>
	<div class="grid gap-3" bind:this={body}>
		<TextField
			label="DOI"
			placeholder="10.1038/nature14539 or https://doi.org/…"
			bind:value
			error={notADoi ? 'That isn’t a DOI. One starts “10.” and has a slash in it.' : undefined}
			oninput={() => (missing = null)}
			onkeydown={(e) => e.key === 'Enter' && submit(true)}
		/>
		{#if online === false}
			<!-- M1b-6 AC-2 -->
			<p class="text-small text-ink-muted">
				Erti won’t fetch its details, so enter them yourself, with the DOI filled in. Lookups can be
				turned on in Settings.
			</p>
		{/if}
		{#if missing}
			<Banner tone="warning">
				doi.org has no details for {missing}, or couldn’t be reached. Check the DOI, or enter the
				details yourself.
			</Banner>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="ghost" disabled={busy} onclick={() => (open = false)}>Cancel</Button>
		{#if online}
			{#if missing}
				<Button disabled={busy} onclick={() => submit(false)}>Enter details</Button>
			{/if}
			<Button
				variant="primary"
				loading={busy}
				disabled={!value.trim()}
				onclick={() => submit(true)}
			>
				{busy ? 'Looking up…' : 'Look up'}
			</Button>
		{:else}
			<Button
				variant="primary"
				loading={busy}
				disabled={!value.trim() || online === null}
				onclick={() => submit(false)}
			>
				Enter details
			</Button>
		{/if}
	{/snippet}
</Dialog>
