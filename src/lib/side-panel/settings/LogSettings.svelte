<script lang="ts">
	import { commands, describeError, run } from '$lib/ipc';
	import { log } from '$lib/log';
	import { errorToast } from '$lib/toast/Toast.svelte';

	// Moves into About when M7a-10 lands (M1a-12 AC-5), and onto the Button
	// primitive with M1c-2.
	async function openLogFolder() {
		try {
			await run(commands.openLogFolder());
		} catch (error) {
			log.error('Could not open the log folder', error);
			errorToast(describeError(error));
		}
	}
</script>

<div class="mb-6">
	<h4 class="text-ink mb-2 block font-medium">Log</h4>
	<p class="text-ink-muted mb-3 text-sm">
		Erti keeps a log of what went wrong, on this computer only. It never holds what you wrote, and
		nothing in it is sent anywhere.
	</p>
	<button
		type="button"
		class="border-line-strong text-ink hover:bg-surface-hover rounded border px-4 py-2 transition-colors"
		onclick={openLogFolder}
	>
		Open log folder
	</button>
</div>
