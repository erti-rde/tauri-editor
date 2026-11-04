<script lang="ts">
	import { describeError, type ZoteroPick } from '$lib/ipc';
	import type { AugmentedZoteroSchema } from '$lib/metadata-explorer/adapterCslZotero';
	import { ImportStopped, type Imported } from '$lib/metadata-explorer/bibliography';
	import { errorToast } from '$lib/ui/Toast.svelte';
	import { Button, Dialog, ProgressLine } from '$lib/ui';

	import { importZotero, type ZoteroPreview } from './importZotero';
	import ZoteroChooser from './ZoteroChooser.svelte';

	/**
	 * Sources › Add › From Zotero… (M1b-11, UX-13): the same tree as New
	 * project, into the open project.
	 */
	interface Props {
		open?: boolean;
		schema: AugmentedZoteroSchema;
		onimported: (imported: Imported) => void;
	}

	let { open = $bindable(false), schema, onimported }: Props = $props();

	let picks = $state.raw<ZoteroPick[]>([]);
	let preview = $state.raw<ZoteroPreview | null>(null);
	let follow = $state(true);
	let progress = $state<{ label: string; done: number; total: number } | null>(null);

	const papers = $derived(preview ? preview.fresh.length + preview.known.length : 0);
	const count = (n: number) => n.toLocaleString('en-GB');

	async function start() {
		if (!preview || progress) return;
		progress = { label: 'Importing from Zotero', done: 0, total: preview.fresh.length };
		let imported: Imported;
		try {
			imported = await importZotero(preview, schema, {
				follow: follow ? picks : null,
				onprogress: (step, done, total) =>
					(progress = {
						label: step === 'importing' ? 'Importing from Zotero' : 'Attaching PDFs',
						done,
						total
					})
			});
		} catch (error) {
			const stopped = error instanceof ImportStopped ? error : null;
			errorToast(
				`The import stopped after ${count(stopped?.imported.added.length ?? 0)}: ${describeError(stopped?.reason ?? error)}`
			);
			progress = null;
			if (!stopped?.imported.added.length) return;
			imported = stopped.imported;
		}
		progress = null;
		open = false;
		onimported(imported);
	}
</script>

<Dialog
	bind:open
	size="md"
	title="Add from Zotero"
	description="PDFs stay where Zotero keeps them. Nothing is added until you say."
	dismissible={!progress}
>
	{#if open}
		<div class="grid gap-3">
			<ZoteroChooser bind:picks bind:preview bind:follow disabled={!!progress} />
			{#if progress}
				<ProgressLine label={progress.label} value={progress.done} max={progress.total} />
			{/if}
		</div>
	{/if}

	{#snippet footer()}
		<Button variant="ghost" onclick={() => (open = false)} disabled={!!progress}>Cancel</Button>
		<Button
			variant="primary"
			onclick={start}
			disabled={papers === 0 || !!progress}
			loading={!!progress}
		>
			{papers > 0 ? `Add ${count(papers)}` : 'Add'}
		</Button>
	{/snippet}
</Dialog>
