<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import Check from '~icons/lucide/check';

	/**
	 * Choosing from a list as you type (M6-8): the citation picker.
	 *
	 * The typing happens somewhere else. The `@` picker's query is typed in the
	 * manuscript, and the caret has to stay there, so this is the list alone:
	 * the field that keeps focus (`owner`) passes its keys to `keydown`, and is
	 * told which option is active through `aria-activedescendant`, which is how
	 * a screen reader follows a list it isn't focused in. bits-ui's combobox
	 * owns its input, so it couldn't be used.
	 *
	 * Up and Down move, wrapping at the ends; Enter chooses. A pointer over an
	 * option makes it the active one, so the keys carry on from where it is.
	 * Pressing an option doesn't take focus from the owner.
	 */
	interface Props {
		/** What the list is of: "Sources". */
		label: string;
		items: readonly T[];
		/** Unique per item: an option's id is built from it. */
		key: (item: T) => string;
		/** The option, as words. The check, the active ground and the rest are drawn here. */
		option: Snippet<[{ item: T; active: boolean; disabled: boolean }]>;
		onchoose: (item: T) => void;
		/** Several can be chosen, each shown with a check. */
		multiple?: boolean;
		selected?: (item: T) => boolean;
		/** Shown, but can't be chosen: a source with no authors to cite. */
		disabled?: (item: T) => boolean;
		/** The option the keys move from. */
		activeIndex?: number;
		/** The element that keeps focus: the editor, or a field. */
		owner?: HTMLElement | null;
		/** What to say when there are no items. Which kind of nothing it is. */
		empty?: Snippet;
		/** Under the list, while there is one: the keys, and a button to finish. */
		footer?: Snippet;
	}

	let {
		label,
		items,
		key,
		option,
		onchoose,
		multiple = false,
		selected = () => false,
		disabled = () => false,
		activeIndex = $bindable(0),
		owner = null,
		empty,
		footer
	}: Props = $props();

	const id = $props.id();
	const optionId = (item: T) => `${id}-${key(item)}`;

	let list = $state<HTMLElement>();

	// A list that shrinks as the query narrows can leave the index past its end.
	const active = $derived(items.length ? Math.min(activeIndex, items.length - 1) : -1);
	const activeId = $derived(active >= 0 ? optionId(items[active]) : undefined);

	/** A key from the owner. True when it was this list's to handle. */
	export function keydown(event: KeyboardEvent): boolean {
		// An input method's keys are its own: the Enter that confirms a name typed
		// in Japanese isn't a choice. WebKit sends that Enter after
		// `compositionend`, with `isComposing` false, so 229 is checked too.
		if (event.isComposing || event.keyCode === 229) return false;
		if (!items.length) return false;
		switch (event.key) {
			case 'ArrowDown':
				activeIndex = (active + 1) % items.length;
				return true;
			case 'ArrowUp':
				activeIndex = (active - 1 + items.length) % items.length;
				return true;
			case 'Enter':
				choose(items[active]);
				return true;
		}
		return false;
	}

	function choose(item: T) {
		if (!disabled(item)) onchoose(item);
	}

	// The list scrolls to the active option, and nothing else does:
	// `scrollIntoView` would scroll every ancestor too, the manuscript under
	// the picker included.
	$effect(() => {
		if (!activeId || !list) return;
		const option = list.querySelector<HTMLElement>(`[id="${CSS.escape(activeId)}"]`);
		if (!option) return;
		const top = option.offsetTop;
		const bottom = top + option.offsetHeight;
		if (top < list.scrollTop) list.scrollTop = top;
		else if (bottom > list.scrollTop + list.clientHeight) {
			list.scrollTop = bottom - list.clientHeight;
		}
	});

	// The owner says it controls this list, and which option is active, for as
	// long as the list is there.
	$effect(() => {
		const element = owner;
		if (!element) return;
		element.setAttribute('aria-controls', id);
		element.setAttribute('aria-expanded', 'true');
		element.setAttribute('aria-autocomplete', 'list');
		return () => {
			for (const name of ['aria-controls', 'aria-expanded', 'aria-autocomplete']) {
				element.removeAttribute(name);
			}
			element.removeAttribute('aria-activedescendant');
		};
	});

	$effect(() => {
		if (!owner) return;
		if (activeId) owner.setAttribute('aria-activedescendant', activeId);
		else owner.removeAttribute('aria-activedescendant');
	});
</script>

<div
	class="shadow-overlay bg-surface-raised border-line-strong text-small text-ink flex w-96 flex-col overflow-hidden rounded-lg border"
>
	{#if items.length}
		<!-- Not focusable: focus stays with the owner, which names the active option. -->
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			bind:this={list}
			{id}
			role="listbox"
			aria-label={label}
			aria-multiselectable={multiple || undefined}
			class="relative grid max-h-72 gap-0.5 overflow-y-auto p-1"
		>
			{#each items as item, index (key(item))}
				{@const isActive = index === active}
				{@const isDisabled = disabled(item)}
				{@const isSelected = selected(item)}
				<!-- The owner's keys reach `keydown`, so a click is the pointer's way only. -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					id={optionId(item)}
					role="option"
					aria-selected={isSelected}
					aria-disabled={isDisabled || undefined}
					class={[
						'flex cursor-default items-start gap-2 rounded px-2 py-1.5 select-none',
						isActive && 'bg-accent-quiet'
					]}
					onpointermove={() => (activeIndex = index)}
					onmousedown={(event) => event.preventDefault()}
					onclick={() => choose(item)}
				>
					{#if multiple}
						<!-- Drawn, not a control: the option is what's chosen. -->
						<span
							class={[
								'mt-0.5 grid size-4 shrink-0 place-items-center rounded border',
								isSelected ? 'bg-accent border-accent text-accent-ink' : 'border-line-control',
								isDisabled && 'invisible'
							]}
							aria-hidden="true"
						>
							{#if isSelected}<Check class="size-3" />{/if}
						</span>
					{/if}
					<div class="grid min-w-0 flex-1 gap-0.5">
						{@render option({ item, active: isActive, disabled: isDisabled })}
					</div>
				</div>
			{/each}
		</div>
	{:else if empty}
		<div class="p-3">{@render empty()}</div>
	{/if}

	<!-- The keys mean nothing with nothing to move through. -->
	{#if footer && items.length}
		<div
			class="border-line bg-surface-sunken text-caption text-ink-muted flex items-center gap-2.5 border-t px-2.5 py-1.5"
		>
			{@render footer()}
		</div>
	{/if}
</div>
