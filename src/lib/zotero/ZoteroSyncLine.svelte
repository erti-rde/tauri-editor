<script lang="ts">
	import { onMount } from 'svelte';

	import { call, commands, describeError, type ZoteroAttach, type ZoteroPick } from '$lib/ipc';
	import {
		zoteroCslMaps,
		type AugmentedZoteroSchema
	} from '$lib/metadata-explorer/adapterCslZotero';
	import { ImportStopped, type Imported } from '$lib/metadata-explorer/bibliography';
	import { Button, ProgressLine } from '$lib/ui';

	import { importZotero, newInSync, previewSync, type ZoteroPreview } from './importZotero';

	/**
	 * One quiet line in Sources for a project that keeps in step with Zotero
	 * (M1b-11 AC-8, UX-13): what it follows, how many papers are new there, and
	 * Sync. Checked when Sources opens and after each sync; never synced
	 * unasked, and a sync removes nothing.
	 */
	interface Props {
		schema: AugmentedZoteroSchema;
		/** Changes when the project gains something to follow. */
		revision?: number;
		onimported: (imported: Imported, gone: number) => void;
	}

	let { schema, revision = 0, onimported }: Props = $props();

	let following = $state.raw<ZoteroPick[]>([]);
	let sync = $state.raw<{
		preview: ZoteroPreview;
		pdfs: ZoteroAttach[];
		gone: number;
	} | null>(null);
	let failed = $state<string | null>(null);
	let progress = $state<{ done: number; total: number } | null>(null);

	async function check() {
		failed = null;
		try {
			following = await call(commands.zoteroFollowing());
			if (following.length === 0) return;
			sync = await previewSync(await zoteroCslMaps());
		} catch (error) {
			failed = describeError(error);
		}
	}

	onMount(check);
	$effect(() => {
		if (revision > 0) void check();
	});

	const names = $derived(
		following
			.map((pick) => pick.name || (pick.kind === 'library' ? 'a library' : 'a paper'))
			.slice(0, 3)
			.join(', ') + (following.length > 3 ? ` and ${following.length - 3} more` : '')
	);
	const fresh = $derived(sync ? newInSync(sync) : 0);

	async function run() {
		if (!sync || progress) return;
		progress = { done: 0, total: fresh };
		let imported: Imported;
		try {
			imported = await importZotero(sync.preview, schema, {
				extra: sync.pdfs,
				onprogress: (_, done, total) => (progress = { done, total })
			});
		} catch (error) {
			imported =
				error instanceof ImportStopped
					? error.imported
					: { added: [], skipped: 0, pdfs: [], attached: [], unattached: [] };
			failed = describeError(error instanceof ImportStopped ? error.reason : error);
		}
		const gone = sync.gone;
		progress = null;
		onimported(imported, gone);
		await check();
	}
</script>

{#if following.length > 0}
	<div class="text-small text-ink-muted mb-4 grid gap-2" data-testid="zotero-sync">
		<p class="flex flex-wrap items-center gap-x-2">
			<span>Following {names} in Zotero</span>
			{#if failed}
				<span>· couldn’t check: {failed}</span>
			{:else if sync}
				<span>· {fresh === 0 ? 'nothing new' : `${fresh.toLocaleString('en-GB')} new`}</span>
			{/if}
			{#if fresh > 0 && !failed}
				<Button size="sm" variant="secondary" onclick={run} loading={!!progress}>Sync</Button>
			{:else if failed}
				<Button size="sm" variant="ghost" onclick={check}>Check again</Button>
			{/if}
		</p>
		{#if progress}
			<ProgressLine label="Syncing with Zotero" value={progress.done} max={progress.total} />
		{/if}
	</div>
{/if}
