<script lang="ts">
	import { untrack } from 'svelte';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';

	import { describeError } from '$lib/ipc';
	import { sourceFiles, type SourceFile } from '$lib/stores/db';
	import { errorToast } from '$lib/toast/Toast.svelte';
	import { Button, EmptyState, Loader } from '$lib/ui';
	import { workspaceStore } from '$lib/workspace/workspaceStore';
	import { retryIngest } from '$utils/pdf_handlers';

	import { attachPdf } from './attach';

	/**
	 * A source's files, in its sidebar's File tab (M1b-7, docs/ux.md UX-3):
	 * where each lives, or that it can't be found, with Open and Show in
	 * folder, and Attach another for a preprint beside its published version.
	 */
	interface Props {
		/** The work's id, or any of its files'. */
		id: string;
		/** A file was attached or read: the table lists it again. */
		onchange: () => void | Promise<void>;
		/** A file was opened in a tab, which the Sources view hides. */
		onopen: () => void;
		/**
		 * Goes up each time the table lists its sources again: a file read, or
		 * retried, from outside this tab. The files are listed again with it.
		 */
		revision?: number;
	}

	let { id, onchange, onopen, revision = 0 }: Props = $props();

	let files: SourceFile[] | null = $state(null);
	let attaching = $state(false);
	let retrying: string | null = $state(null);

	async function load() {
		try {
			files = await sourceFiles(id);
		} catch (error) {
			files = [];
			errorToast(`Could not list its files: ${describeError(error)}`);
		}
	}

	$effect(() => {
		void revision;
		untrack(load);
	});

	async function attach() {
		attaching = true;
		try {
			await attachPdf(id, async () => {
				await load();
				await onchange();
			});
		} finally {
			attaching = false;
		}
	}

	/** A file that couldn't be read, read again, under its own hash (ADR 003). */
	async function retry(file: SourceFile) {
		retrying = file.sha256;
		try {
			await retryIngest({ sha256: file.sha256, path: file.path, file_name: file.file_name });
		} catch (error) {
			errorToast(`Could not read it: ${describeError(error)}`);
		} finally {
			retrying = null;
		}
		await load();
		await onchange();
	}

	function openFile(file: SourceFile) {
		workspaceStore.open({ id: file.path, kind: 'pdf', title: file.file_name });
		onopen();
	}

	async function reveal(file: SourceFile) {
		try {
			await revealItemInDir(file.path);
		} catch (error) {
			errorToast(`Could not show it: ${describeError(error)}`);
		}
	}
</script>

{#if files === null}
	<div class="flex justify-center py-6"><Loader /></div>
{:else if files.length === 0}
	<EmptyState
		message="No file"
		detail="Attach the PDF to search it and mark it up alongside its details."
		action={{ label: 'Attach PDF…', onclick: attach }}
	/>
{:else}
	<ul class="grid gap-4">
		{#each files as file (file.sha256)}
			<li class="grid gap-1.5">
				<p class="text-body text-ink font-medium break-all">{file.file_name}</p>
				{#if file.state === 'pending'}
					<p class="text-caption text-ink-muted">Reading…</p>
				{:else if file.state === 'failed'}
					<p class="text-caption text-warning">
						Couldn’t read it{file.last_error ? `: ${file.last_error}` : '.'}
					</p>
				{/if}
				{#if file.found}
					<p class="text-caption text-ink-muted break-all">{file.path}</p>
				{:else}
					<p class="text-caption text-warning break-all">
						File not found. Last seen at {file.path}
					</p>
				{/if}
				<div class="flex gap-2">
					{#if file.state === 'failed' && file.found}
						<!-- The table's row and banner show one file per source, so a
						     second file that failed is retried here or nowhere. -->
						<Button size="sm" loading={retrying === file.sha256} onclick={() => retry(file)}>
							Retry
						</Button>
					{/if}
					<Button size="sm" disabled={!file.found} onclick={() => openFile(file)}>Open</Button>
					<Button size="sm" variant="ghost" disabled={!file.found} onclick={() => reveal(file)}>
						Show in folder
					</Button>
				</div>
			</li>
		{/each}
	</ul>
	<div class="mt-5">
		<Button size="sm" loading={attaching} onclick={attach}>Attach another…</Button>
	</div>
{/if}
