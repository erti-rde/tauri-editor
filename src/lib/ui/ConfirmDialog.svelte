<script lang="ts">
	import type { Snippet } from 'svelte';

	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';

	/**
	 * Before something that can't be taken back (docs/ux.md UX-4). It says what
	 * the action touches, and its one danger button says the verb: "Remove",
	 * not "OK". Cancel is the other way out, and so are Escape and the close
	 * button.
	 */
	interface Props {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		/** The question: "Remove Orality and Literacy?" */
		title: string;
		/** The verb on the danger button: "Remove". */
		action: string;
		/** What it touches: counts, what stays, and how to get it back if anything. */
		consequences: Snippet;
		onConfirm: () => void | Promise<void>;
		/** Working: the action is under way and can't be pressed again. */
		busy?: boolean;
	}

	let {
		open = $bindable(false),
		onOpenChange,
		title,
		action,
		consequences,
		onConfirm,
		busy = false
	}: Props = $props();

	function close() {
		open = false;
		onOpenChange?.(false);
	}
</script>

<!-- While busy, nothing closes it: the action it started is still under way,
     and its outcome is said here. -->
<Dialog bind:open {onOpenChange} {title} size="sm" dismissible={!busy}>
	<div class="text-small text-ink grid gap-2">
		{@render consequences()}
	</div>
	{#snippet footer()}
		<Button onclick={close} disabled={busy}>Cancel</Button>
		<Button variant="danger" loading={busy} onclick={onConfirm}>{action}</Button>
	{/snippet}
</Dialog>
