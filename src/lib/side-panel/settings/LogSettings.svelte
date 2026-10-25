<script lang="ts">
	import { commands, describeError, run } from '$lib/ipc';
	import { log } from '$lib/log';
	import { Button, SettingRow } from '$lib/ui';
	import { errorToast } from '$lib/ui/Toast.svelte';

	// Moves into About when M7a-10 lands (M1a-12 AC-5).
	async function openLogFolder() {
		try {
			await run(commands.openLogFolder());
		} catch (error) {
			log.error('Could not open the log folder', error);
			errorToast(describeError(error));
		}
	}
</script>

<SettingRow
	label="Log"
	hint="Erti keeps a log of what went wrong, on this computer only. It never holds what you wrote, and nothing in it is sent anywhere."
>
	{#snippet children({ hintId })}
		<Button size="sm" aria-describedby={hintId} onclick={openLogFolder}>Open log folder</Button>
	{/snippet}
</SettingRow>
