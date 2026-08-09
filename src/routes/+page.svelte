<script lang="ts">
	import { onMount } from 'svelte';
	import { appDataDir, homeDir, join } from '@tauri-apps/api/path';
	import { load as loadStore } from '@tauri-apps/plugin-store';
	import {
		Editor,
		Explorer,
		Landing,
		PdfReader,
		SidePanel,
		StatusFooter,
		MetadataEditor
	} from '$lib';
	import { importLegacyMetadata, openLibrary, openProject } from '$lib/stores/db';
	import { getConsent } from '$lib/stores/consent';
	import { errorToast } from '$lib/toast/Toast.svelte';
	import ConsentPrompt from '$lib/consent/ConsentPrompt.svelte';
	import { fileSystemStore, fileSystemState } from '$lib/stores/fileSystem.svelte';
	import { extractAndChunkPdfs } from '$utils/pdf_handlers';

	import type { PanelNames } from '$types/page';

	// Asked once, before anything can be sent anywhere.
	let askForConsent = $state(false);

	// A library that failed to open does not resolve by itself, and every later
	// action depends on it — so this is persistent, not a dismissible toast.
	let startupError: string | null = $state(null);

	let isExplorerOpen = $state(true);
	let vaultIsOpen = $state(false);
	let panelName: PanelNames = $state('fileExplorer');

	function toggleSidePanel(newSidePanelName: PanelNames) {
		if (newSidePanelName === panelName || !isExplorerOpen) {
			isExplorerOpen = !isExplorerOpen;
		}
		panelName = newSidePanelName;
	}

	let isItPdf = $derived(() => {
		return fileSystemState.currentFile && fileSystemState.currentFile.endsWith('.pdf');
	});

	async function handleProjectOpening() {
		// The project database lives at <project>/.erti/project.db and is created
		// on first open, so each project keeps its own manuscripts, source set and
		// metadata corrections while sharing the one library of sources.
		try {
			await openProject($fileSystemStore.currentPath);
		} catch (error) {
			// Leave the project closed rather than showing an empty workspace.
			errorToast(`Could not open this project: ${message(error)}`);
			return;
		}

		vaultIsOpen = true;

		try {
			await extractAndChunkPdfs();
		} catch (error) {
			errorToast(`Could not scan this folder: ${message(error)}`);
		}
	}

	const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

	/**
	 * Where the shared source library lives.
	 *
	 * Configurable and defaulting to ~/Erti, the way Zotero exposes its data
	 * directory: a corpus is worth putting somewhere the user can back up or sync,
	 * rather than burying it in an application-support folder.
	 */
	async function libraryPath(): Promise<string> {
		const settings = await loadStore('settings-store.json');
		const configured = (await settings.get('libraryPath')) as string | undefined;
		if (configured) return configured;

		return join(await homeDir(), 'Erti', 'library.db');
	}

	onMount(async () => {
		// The app has always sent titles and page text to Crossref during ingest
		// while promising it would not without consent. Ask before the first scan.
		askForConsent = (await getConsent()) === 'unasked';

		try {
			await openLibrary(await libraryPath());
		} catch (error) {
			startupError = message(error);
			return;
		}

		// Carry forward whatever the pre-hybrid database resolved. Idempotent, so
		// it can run on every launch; the old database is only read and is left
		// on disk. Failing here must not stop the app from opening.
		try {
			const legacy = await join(await appDataDir(), 'magnum_opus_test.db');
			const report = await importLegacyMetadata(legacy);
			if (report.imported > 0) {
				console.info(
					`Carried forward metadata for ${report.imported} sources from the previous library.`
				);
			}
		} catch (error) {
			console.error('Could not read the previous library:', error);
		}
	});
</script>

{#if startupError}
	<div class="border-danger bg-surface-sunken text-danger border-b px-4 py-3">
		<span class="font-medium">Erti could not open your source library.</span>
		{startupError}
	</div>
{/if}

{#if askForConsent}
	<ConsentPrompt onchoice={() => (askForConsent = false)} />
{/if}

<div class="flex h-screen flex-col">
	<div class="flex min-h-0 grow">
		<div class="min-w-(--toolbar-l) shrink-0">
			<SidePanel {toggleSidePanel} />
		</div>
		{#if vaultIsOpen}
			<div class={['shrink-0', !isExplorerOpen && 'w-0 p-0']}>
				<Explorer {isExplorerOpen} />
			</div>

			<div class="grow">
				{#if panelName == 'metadataExplorer'}
					<MetadataEditor />
				{:else if isItPdf()}
					<PdfReader />
				{:else}
					<Editor />
				{/if}
			</div>
		{:else}
			<div class="my-auto flex h-full w-full items-center justify-center">
				<Landing {handleProjectOpening} />
			</div>
		{/if}
	</div>
	<div class="z-10 shrink-0">
		<StatusFooter />
	</div>
</div>
