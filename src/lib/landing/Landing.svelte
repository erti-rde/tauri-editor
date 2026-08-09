<script lang="ts">
	import { open } from '@tauri-apps/plugin-dialog';
	import { documentDir } from '@tauri-apps/api/path';
	import { exists } from '@tauri-apps/plugin-fs';
	import { onMount } from 'svelte';

	import { fileSystemStore } from '$lib/stores/fileSystem.svelte';
	import { errorToast } from '$lib/toast/Toast.svelte';
	import {
		describeWhen,
		forgetProject,
		readRecents,
		rememberProject,
		type RecentProject
	} from './recentProjects';

	/**
	 * The first thing anyone sees.
	 *
	 * It was a sentence and a button, which meant walking the folder picker to
	 * yesterday's work on every launch — the single most common thing anyone does
	 * here. The recent list is the whole point; opening a new folder is the rarer
	 * case and sits below it.
	 */

	interface Props {
		handleProjectOpening: () => void;
	}

	const { handleProjectOpening }: Props = $props();

	let recents = $state<RecentProject[]>([]);
	let missing = $state<Set<string>>(new Set());
	let busy = $state<string | null>(null);

	onMount(async () => {
		recents = await readRecents();

		// A project folder can be moved, renamed or deleted between launches.
		// Checking up front means the list says which are gone rather than
		// failing when one is clicked.
		const gone = await Promise.all(
			recents.map(async (p) => ((await exists(p.path)) ? null : p.path))
		);
		missing = new Set(gone.filter((p): p is string => p !== null));
	});

	async function openProject(path: string) {
		if (busy) return;
		busy = path;

		try {
			await fileSystemStore.readDirectory(path);
			await rememberProject(path);
			handleProjectOpening();
		} catch (error) {
			console.error('Could not open the project:', error);
			errorToast(
				`Could not open ${path}: ${error instanceof Error ? error.message : String(error)}`
			);
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

	async function remove(path: string) {
		recents = await forgetProject(path);
	}
</script>

<div class="flex h-full w-full items-center justify-center p-8">
	<div class="w-full max-w-lg">
		<header class="mb-8">
			<h1 class="text-ink text-2xl font-semibold tracking-tight">Erti</h1>
			<p class="text-ink-muted mt-1 text-sm">
				A project is a folder: your PDFs, your notes and your writing, all on this machine.
			</p>
		</header>

		{#if recents.length > 0}
			<h2 class="text-ink-muted mb-2 text-[11px] font-medium tracking-wide uppercase">Recent</h2>

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
								<span class="text-ink block truncate text-sm">{project.name}</span>
								<span class="text-ink-muted block truncate font-mono text-[11px]">
									{project.path}
								</span>
							</span>
							<span class="text-ink-muted ml-auto shrink-0 text-[11px] whitespace-nowrap">
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

						<button
							type="button"
							class="text-ink-muted hover:text-ink px-3 text-xs transition-colors"
							onclick={() => remove(project.path)}
							aria-label="Remove {project.name} from this list"
							title="Remove from this list"
						>
							×
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<button
			type="button"
			class="bg-accent text-accent-ink hover:bg-accent-hover w-full rounded px-4 py-2 text-sm font-medium transition-colors"
			onclick={chooseFolder}
			disabled={busy !== null}
		>
			{recents.length > 0 ? 'Open another folder…' : 'Open a project folder…'}
		</button>

		{#if recents.length === 0}
			<p class="text-ink-muted mt-3 text-xs">
				Choose a folder containing your PDFs. Erti reads them, finds their citation details, and
				keeps everything in that folder.
			</p>
		{/if}
	</div>
</div>
