<script lang="ts">
	import { open } from '@tauri-apps/plugin-dialog';
	import { documentDir } from '@tauri-apps/api/path';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import X from '~icons/lucide/x';

	import { call, commands } from '$lib/ipc';
	import type { Imported } from '$lib/metadata-explorer/bibliography';
	import { fileSystemStore } from '$lib/stores/fileSystem.svelte';
	import { Button, IconButton } from '$lib/ui';
	import { errorToast, successToast } from '$lib/ui/Toast.svelte';
	import { announce } from '$lib/zotero/importZotero';
	import { ingestAll } from '$utils/pdf_handlers';
	import NewProject from './NewProject.svelte';
	import {
		describeWhen,
		forgetProject,
		readRecents,
		rememberProject,
		type RecentProject
	} from './recentProjects';
	import { log } from '$lib/log';

	/**
	 * The first thing anyone sees.
	 *
	 * It was a sentence and a button, which meant walking the folder picker to
	 * yesterday's work on every launch — the single most common thing anyone does
	 * here. The recent list is the whole point; opening a new folder is the rarer
	 * case and sits below it.
	 */

	interface Props {
		/** Open the folder just read as the project; says whether it opened. */
		handleProjectOpening: () => Promise<boolean>;
	}

	const { handleProjectOpening }: Props = $props();

	let recents = $state<RecentProject[]>([]);
	let missing = $state<Set<string>>(new Set());
	let busy = $state<string | null>(null);
	let creating = $state(false);

	onMount(async () => {
		recents = await readRecents();

		// A project folder can be moved, renamed or deleted between launches.
		// Checking up front means the list says which are gone rather than
		// failing when one is clicked.
		// Asked of Rust rather than the fs plugin, which can no longer see
		// outside the open project (M1a-4). A folder is present if Erti's
		// `.erti` folder is still in it.
		try {
			const present = await call(commands.recentProjectsPresent(recents.map((p) => p.path)));
			missing = new Set(recents.filter((_, i) => !present[i]).map((p) => p.path));
		} catch (error) {
			log.error('Could not check the recent projects', error);
		}
	});

	/** Whether the workspace opened on `path`. */
	async function openProject(path: string): Promise<boolean> {
		if (busy) return false;
		busy = path;

		try {
			// The store keeps a failed read to itself, and the folder read last.
			await fileSystemStore.readDirectory(path);
			const read = get(fileSystemStore);
			if (read.error || read.currentPath !== path) {
				throw new Error(read.error ?? 'Erti could not read the folder.');
			}
			await rememberProject(path);
			return await handleProjectOpening();
		} catch (error) {
			log.error('Could not open the project', error);
			errorToast(
				`Could not open ${path}: ${error instanceof Error ? error.message : String(error)}`
			);
			return false;
		} finally {
			busy = null;
		}
	}

	async function chooseFolder() {
		const selected = await open({
			directory: true,
			multiple: false,
			defaultPath: await documentDir()
		});

		if (typeof selected === 'string') await openProject(selected);
	}

	/**
	 * A project just made (M1b-11): opened as a recent one is, then what was
	 * imported into it said, and its PDFs read. An import that stopped says
	 * why as well, here: the dialog has closed by then.
	 */
	async function openNew(path: string, imported: Imported | null, failure: string | null) {
		if (!(await openProject(path))) return;
		if (imported) {
			void announce(imported, {
				into: 'the new project',
				read: ingestAll,
				success: successToast,
				failure: errorToast
			});
		}
		if (failure) errorToast(`The import from Zotero stopped: ${failure}`);
	}

	async function remove(path: string) {
		recents = await forgetProject(path);
	}
</script>

<div class="flex h-full w-full items-center justify-center p-8">
	<div class="w-full max-w-lg">
		<header class="mb-8">
			<h1 class="text-ink text-2xl font-semibold tracking-tight">Erti</h1>
			<p class="text-ink-muted text-small mt-1">
				A project is a folder: your PDFs, your notes and your writing, all on this machine.
			</p>
		</header>

		{#if recents.length > 0}
			<h2 class="text-ink-muted text-caption mb-2 font-medium tracking-wide uppercase">Recent</h2>

			<ul class="border-line mb-6 divide-y rounded border">
				{#each recents as project (project.path)}
					{@const gone = missing.has(project.path)}
					<li class="flex items-stretch">
						<button
							type="button"
							class="hover:bg-surface-hover flex min-w-0 grow items-baseline gap-3 px-3 py-2 text-left transition-colors disabled:cursor-not-allowed"
							onclick={() => openProject(project.path)}
							disabled={gone || busy !== null}
						>
							<span class="min-w-0">
								<span class="text-ink text-small block truncate">{project.name}</span>
								<span class="text-ink-muted text-caption block truncate font-mono">
									{project.path}
								</span>
							</span>
							<span class="text-ink-muted text-caption ml-auto shrink-0 whitespace-nowrap">
								{#if gone}
									<!-- Said rather than hidden: someone whose project has moved wants
									     to know where Erti last saw it. -->
									<span class="text-warning">not found</span>
								{:else if busy === project.path}
									opening…
								{:else}
									{describeWhen(project.openedAt)}
								{/if}
							</span>
						</button>

						<span class="flex items-center px-1">
							<IconButton
								size="sm"
								icon={X}
								label="Remove {project.name} from this list"
								onclick={() => remove(project.path)}
							/>
						</span>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="grid grid-cols-2 gap-2">
			<Button variant="primary" onclick={() => (creating = true)} disabled={busy !== null}>
				New project…
			</Button>
			<Button variant="secondary" onclick={chooseFolder} disabled={busy !== null}>
				{recents.length > 0 ? 'Open another folder…' : 'Open a project folder…'}
			</Button>
		</div>

		{#if recents.length === 0}
			<p class="text-ink-muted text-caption mt-3">
				Start a new project, from Zotero if you use it, or open a folder containing your PDFs. Erti
				reads them, finds their citation details, and keeps your writing in that folder.
			</p>
		{/if}
	</div>
</div>

<NewProject bind:open={creating} onready={openNew} />
