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

	let url = $state<string>('');

	// Initialize url and position based on props
	$effect(() => {
		url = editor.getAttributes('link').href || '';
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
		console.log('pos', position);

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
		console.log('Opening link:', safeUrl);
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
			class="shadow-popo data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-30 w-full max-w-[328px] origin-(--bits-popover-content-transform-origin) rounded-[12px] border border-orange-200 bg-orange-50 p-4"
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

				<Separator.Root class="mx-1 w-[1px] self-stretch bg-orange-200" />

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
