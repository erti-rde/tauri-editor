<script lang="ts">
	/**
	 * A keyboard shortcut. Monospaced, because a shortcut is characters to be
	 * typed exactly, and proportional digits make that harder to read small.
	 */
	interface Props {
		/** The keys, as the toolbar writes them: "Mod Shift Z". */
		keys: string;
	}

	let { keys }: Props = $props();
</script>

<kbd class="border-line text-ink-muted text-caption rounded border px-1 font-mono">{keys}</kbd>
