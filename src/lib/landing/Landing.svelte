<script lang="ts">
	import { open } from '@tauri-apps/plugin-dialog';
	import { documentDir } from '@tauri-apps/api/path';

	import { fileSystemStore } from '$lib/stores/fileSystem';

	interface Props {
		handleProjectOpening: () => void;
	}

	const { handleProjectOpening }: Props = $props();

	async function handleFolderOpen() {
		// Open a selection dialog for directories
		const selected = await open({
			directory: true,
			multiple: false,
			defaultPath: await documentDir()
		});
		if (selected) {
			const dirPath = selected as string;
			await fileSystemStore.readDirectory(dirPath);
			handleProjectOpening();
		}
	}
</script>

<div>
	<p>To get started open your project</p>
	<button class="w-100px bg-orange-200 p-2" onclick={handleFolderOpen}>Open</button>
</div>

<style>
	div {
		display: flex;
		flex-direction: column;
		margin: auto 0;
	}
</style>
