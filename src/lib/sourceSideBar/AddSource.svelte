<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	import { open } from '@tauri-apps/api/dialog';
	import { Icon } from '$lib';
	import { setStatus } from '$lib/statusFooter/StatusFooter.svelte';
	import { tokeniseSource, createMetadata } from '$utils/api';

	const dispatch = createEventDispatcher();

	async function handleUpload() {
		const files = (await open({
			multiple: true
		})) as string[];
		try {
			files &&
				(await Promise.all(
					files.map(async (filePath) => {
						const fileName = filePath.split(/\/|\\/).pop() as string;
						await createMetadata(filePath, fileName);
						setStatus({ side: 'left', message: `Processing ${fileName}...`, type: 'info' });
						const result = await tokeniseSource(filePath, fileName);
						if (result.status === 'completed') {
							setStatus({ side: 'right', message: '', type: 'success' });
							dispatch('sourceAdded');
						}
					})
				));
		} catch (e) {
			setStatus({ side: 'right', message: `an error occurred ${e}`, type: 'error' });
		}
	}
</script>

<button class="add-file cursor-pointer p-1" on:click={handleUpload}
	><Icon icon="FilePlus" size="s" /></button
>
