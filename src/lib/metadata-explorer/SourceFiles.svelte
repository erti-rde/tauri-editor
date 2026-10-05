<script lang="ts">
	import { onMount } from 'svelte';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';

	import { describeError } from '$lib/ipc';
	import { sourceFiles, type SourceFile } from '$lib/stores/db';
	import { errorToast } from '$lib/toast/Toast.svelte';
	import { Button, EmptyState, Loader } from '$lib/ui';
	import { workspaceStore } from '$lib/workspace/workspaceStore';

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
	}

	let { id, onchange, onopen }: Props = $props();

	let files: SourceFile[] | null = $state(null);
	let attaching = $state(false);

	async function load() {
		try {
			files = await sourceFiles(id);
		} catch (error) {
			files = [];
			errorToast(`Could not list its files: ${describeError(error)}`);
		}
	}

	onMount(load);

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
