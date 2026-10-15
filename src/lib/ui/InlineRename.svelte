<script lang="ts">
	import { Popover } from 'bits-ui';
	import { onMount } from 'svelte';

	import { controlClass } from './Field.svelte';

	/**
	 * A name changed where it's read: a document's tab, a label in the reader
	 * (docs/ux.md UX-9). Opens with the name selected, so typing replaces it.
	 * Enter renames, Escape puts the old name back, and clicking away renames.
	 *
	 * A name that can't be used says why beside the field, and the field stays:
	 * Enter does nothing until it's fixed. Clicking away from one puts the old
	 * name back, since there's nowhere left to say what was wrong.
	 */
	interface Props {
		/** The name as it is. */
		value: string;
		/** What's being named, for a screen reader: "Name for Chapter 1". */
		label: string;
		/** Called once, with the new name trimmed, only if it changed and passed. */
		oncommit: (name: string) => void;
		/** The old name stays: Escape, an unchanged name, or one that can't be used. */
		oncancel?: () => void;
		/** Why a name can't be used, in words that say how to fix it; nothing when it can. */
		validate?: (name: string) => string | undefined;
		placeholder?: string;
		class?: string;
	}

	const { value, label, oncommit, oncancel, validate, placeholder, class: extra }: Props = $props();

	// A draft from the name as it was when renaming began; the parent's value
	// doesn't change under the writer while they type.
	// svelte-ignore state_referenced_locally
	let draft = $state(value);
	let input = $state<HTMLInputElement>();
	let done = false;
	const errorId = $props.id();

	const error = $derived.by(() => {
		const name = draft.trim();
		if (name === value.trim()) return undefined;
		return validate?.(name);
	});

	onMount(() => {
		input?.focus();
		input?.select();
	});

	/**
	 * Once. Enter and Escape end renaming, which removes the field, and the
	 * browser blurs it on the way out: without the flag that blur renamed again,
	 * or renamed what Escape meant to cancel (DocumentBar, M1a).
	 */
	function finish(keep: boolean) {
		if (done) return;
		const name = draft.trim();
		const changed = name.length > 0 && name !== value.trim();
		if (keep && changed && error === undefined) {
			done = true;
			oncommit(name);
		} else {
			done = true;
			oncancel?.();
		}
	}

	function onkeydown(event: KeyboardEvent) {
		// The keys are the field's: a menu around it would take letters for
		// type-ahead, and the editor would take its shortcuts.
		event.stopPropagation();
		if (event.key === 'Enter') {
			event.preventDefault();
			if (error === undefined) finish(true);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			finish(false);
		}
	}
</script>

<span class={['relative inline-flex min-w-0', extra]}>
	<input
		bind:this={input}
		bind:value={draft}
		aria-label={label}
		aria-invalid={error !== undefined || undefined}
		aria-describedby={error !== undefined ? errorId : undefined}
		{placeholder}
		spellcheck="false"
		autocomplete="off"
		class={[controlClass, 'h-5 min-w-0 px-1.5']}
		{onkeydown}
		onblur={() => finish(true)}
	/>
</span>

<!-- Said beside the field rather than under it: a tab bar is one row high
     and scrolls sideways, so anything inside it below the field is cut off.
     Not modal, and it never takes focus: the writer is still typing. -->
<Popover.Root open={error !== undefined}>
	<Popover.Portal>
		<Popover.Content
			customAnchor={input}
			side="bottom"
			align="start"
			sideOffset={4}
			trapFocus={false}
			onOpenAutoFocus={(event) => event.preventDefault()}
			onCloseAutoFocus={(event) => event.preventDefault()}
			interactOutsideBehavior="ignore"
			escapeKeydownBehavior="ignore"
			data-rename-error
			class="shadow-overlay bg-surface-raised border-danger z-50 max-w-72 rounded border px-2 py-1 outline-hidden"
		>
			<p id={errorId} class="text-caption text-ink">{error}</p>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
