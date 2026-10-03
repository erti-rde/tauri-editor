<script lang="ts">
	import { type Editor } from '@tiptap/core';

	import type { Snippet } from 'svelte';

	import { Popover, Separator } from 'bits-ui';
	import { openUrl } from '@tauri-apps/plugin-opener';

	import CornerDownLeft from '~icons/lucide/corner-down-left';
	import ExternalLink from '~icons/lucide/external-link';
	import Trash from '~icons/lucide/trash';

	import { sanitizeUrl } from '$utils/tiptap-utils';

	interface Props {
		editor: Editor;
		isActive: boolean;
		children: Snippet;
	}

	let { isActive, children, editor }: Props = $props();

	let url = $state('');

	// editor.getAttributes() reads ProseMirror state, which is not a Svelte
	// reactive source — neither $derived nor a bare $effect re-runs when the
	// selection moves. Without subscribing, moving between links leaves the
	// previous href in the field, and pressing Enter submits it.
	$effect(() => {
		const syncUrl = () => {
			url = editor.getAttributes('link').href || '';
		};

		syncUrl();
		editor.on('selectionUpdate', syncUrl);
		return () => {
			editor.off('selectionUpdate', syncUrl);
		};
	});

	function setLink() {
		editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
	}

	function removeLink() {
		editor
			.chain()
			.focus()
			.extendMarkRange('link')
			.unsetLink()
			.setMeta('preventAutolink', true)
			.run();
	}

	function closePopover() {
		isActive = false;
		const position = editor.state.selection.$anchor.pos;

		editor.commands.focus(position);
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			setLink();
			closePopover();
		}
		if (event.key === 'Escape') {
			closePopover();
		}
	}

	async function handleOpenLink() {
		if (!url) return;
		const safeUrl = sanitizeUrl(url, window.location.href);
		if (safeUrl !== '#') {
			await openUrl(safeUrl);
			closePopover();
		}
	}
</script>

<Popover.Root bind:open={isActive}>
	<Popover.Trigger>
		{@render children()}
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content
			trapFocus={false}
			class="shadow-popo data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 border-line bg-surface-overlay z-30 w-full max-w-[328px] origin-(--bits-popover-content-transform-origin) rounded-[12px] border p-4"
			sideOffset={8}
		>
			<div class="flex items-center">
				<input
					type="url"
					placeholder="Paste a link..."
					bind:value={url}
					onkeydown={handleKeyDown}
					autoComplete="off"
					autoCorrect="off"
					autoCapitalize="off"
					class="focus:outline-none"
				/>

				<div>
					<button
						type="button"
						onclick={setLink}
						title="Apply link"
						disabled={!url && !isActive}
						class={[!url && 'cursor-not-allowed opacity-40']}
					>
						<CornerDownLeft />
					</button>
				</div>

				<Separator.Root class="bg-line mx-1 w-px self-stretch" />

				<div>
					<button
						onclick={handleOpenLink}
						title="Open in new window"
						disabled={!url && !isActive}
						class={[!url && 'cursor-not-allowed opacity-40']}
					>
						<ExternalLink />
					</button>

					<button
						onclick={removeLink}
						title="Remove link"
						disabled={!url && !isActive}
						class={[!url && 'cursor-not-allowed opacity-40']}
					>
						<Trash />
					</button>
				</div>
			</div>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
