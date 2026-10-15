<script lang="ts">
	import Ellipsis from '~icons/lucide/ellipsis';
	import X from '~icons/lucide/x';

	import IconButton from './IconButton.svelte';
	import InlineRename from './InlineRename.svelte';
	import Menu, { type MenuItem } from './Menu.svelte';
	import type { IconComponent } from './icon';

	/**
	 * One open file in a tab strip: a manuscript, or a paper beside it
	 * (docs/ux.md UX-9). The current one is told three ways: its surface, an
	 * accent rule along its top, and `aria-selected`. Its ⋯ menu shows on the
	 * current tab only, so the strip stays quiet, and its name can be changed in
	 * place (`InlineRename`).
	 *
	 * A div with the tab role rather than a button: the ⋯ and close controls are
	 * buttons, and a button inside a button is invalid, which the parser fixes
	 * by closing the outer one early. Named by its title alone, or the names of
	 * those buttons would be read as part of it.
	 */
	interface Props {
		title: string;
		icon?: IconComponent;
		/** The one on screen. */
		current?: boolean;
		onselect: () => void;
		/** Its menu, on the current tab only: Rename…, Duplicate… */
		menu?: MenuItem[];
		/** Shows a close button, and closes on a middle-click as editors do. */
		onclose?: () => void;
		/** The name is a field (`InlineRename`) until it's committed or cancelled. */
		renaming?: boolean;
		onrename?: (name: string) => void;
		oncancelrename?: () => void;
		/** Why a name can't be used, for `InlineRename`. */
		validate?: (name: string) => string | undefined;
	}

	const {
		title,
		icon: Icon,
		current = false,
		onselect,
		menu,
		onclose,
		renaming = false,
		onrename,
		oncancelrename,
		validate
	}: Props = $props();

	const showMenu = $derived(current && !renaming && (menu?.length ?? 0) > 0);
</script>

<div
	role="tab"
	aria-label={title}
	tabindex={current ? 0 : -1}
	aria-selected={current}
	data-current={current || undefined}
	class={[
		'group border-line text-small ease-standard flex max-w-56 min-w-0 shrink-0 cursor-default items-center gap-1.5 border-t-2 border-r pl-3 whitespace-nowrap transition-colors duration-(--duration-fast)',
		showMenu || onclose ? 'pr-1' : 'pr-3',
		current
			? 'bg-surface text-ink border-t-accent'
			: 'text-ink-muted hover:bg-surface-hover hover:text-ink border-t-transparent'
	]}
	onclick={() => {
		if (!renaming) onselect();
	}}
	onkeydown={(event) => {
		if (event.target !== event.currentTarget) return;
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onselect();
		}
	}}
	onauxclick={(event) => {
		if (event.button === 1 && onclose) {
			event.preventDefault();
			onclose();
		}
	}}
>
	{#if Icon}
		<Icon class="size-3.5 shrink-0" aria-hidden="true" />
	{/if}

	{#if renaming && onrename}
		<InlineRename
			value={title}
			label="Name for {title}"
			class="w-40"
			{validate}
			oncommit={onrename}
			oncancel={oncancelrename}
		/>
	{:else}
		<span class="truncate">{title}</span>
	{/if}

	{#if showMenu}
		<Menu label="{title} menu" items={menu!} icon={Ellipsis} />
	{/if}

	{#if onclose}
		<!-- Shown on the current tab, and on another while it's hovered or
		     focused, so the strip isn't a row of crosses. -->
		<IconButton
			label="Close {title}"
			icon={X}
			size="sm"
			class={current
				? ''
				: 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 focus-visible:opacity-100'}
			onclick={(event) => {
				event.stopPropagation();
				onclose();
			}}
		/>
	{/if}
</div>
