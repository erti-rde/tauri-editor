<script lang="ts">
	import Icon from '$lib/icon/Icon.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';

	import AppearanceMenu, { type PageTheme } from './AppearanceMenu.svelte';
	import LabelPicker from './LabelPicker.svelte';

	import type { FindSummary, ScrollModeName, SpreadModeName } from './viewer';
	import type { AnnotationLabel } from '$lib/stores/db';
	import type { ReaderTool } from './tools';

	/**
	 * The reader's chrome.
	 *
	 * Owning the viewer meant owning this: pdf.js's stock toolbar went with the
	 * iframe, and page navigation and search are not optional in a reader. It is
	 * built on the application's tokens rather than pdf.js's stylesheet, so it
	 * follows the chosen palette like everything else instead of sitting in the
	 * middle of the window in a different grey.
	 *
	 * Arranged in Zotero's three groups, because that arrangement is load-bearing
	 * rather than decorative. Getting about the paper sits on the left, the tools
	 * that change it sit in the middle where they read as one exclusive choice,
	 * and the things that change how it looks sit on the right. A flat row of
	 * eighteen icons — which is what this was — makes "turn the page" and "mark
	 * this passage permanently" look like the same kind of act.
	 */

	interface Props {
		page: number;
		pages: number;
		/** What this sheet is called in the paper, when the file says. */
		pageLabel: string | null;
		scale: number;
		find: FindSummary | null;
		searching: boolean;
		onpage: (page: number) => void;
		/** A page box entry, which may be a printed page number rather than a sheet. */
		ongoto: (value: string) => void;
		onzoom: (factor: number) => void;
		onfit: () => void;
		onsearch: (query: string, options?: { again?: boolean; backwards?: boolean }) => void;
		onclosesearch: () => void;
		ontogglesearch: () => void;
		/** Somewhere the reader jumped from, and can return to. */
		canGoBack: boolean;
		onback: () => void;
		/** How many marks this paper carries, shown so the panel is worth opening. */
		marks: number;
		sidebarOpen: boolean;
		ontogglesidebar: () => void;
		/** Open the panel on the marks, wherever it was left. */
		onshowmarks: () => void;
		/**
		 * Which tool is in hand, or null for none.
		 *
		 * One at a time, as in Zotero: highlighting and dragging a box over a
		 * figure are different acts and holding both would mean guessing which was
		 * meant on every drag.
		 */
		tool: ReaderTool;
		ontool: (tool: ReaderTool) => void;
		labels: AnnotationLabel[];
		lastLabel: string | null;
		onlabel: (labelId: string) => void;
		onrename: (label: AnnotationLabel, name: string) => void;
		onresetnames: () => void;
		scrollMode: ScrollModeName;
		spreadMode: SpreadModeName;
		rotation: number;
		pageTheme: PageTheme;
		onscrollmode: (mode: ScrollModeName) => void;
		onspreadmode: (mode: SpreadModeName) => void;
		onrotate: (degrees: number) => void;
		onpagetheme: (theme: PageTheme) => void;
	}

	const {
		page,
		pages,
		pageLabel,
		scale,
		find,
		searching,
		onpage,
		ongoto,
		onzoom,
		onfit,
		onsearch,
		onclosesearch,
		ontogglesearch,
		canGoBack,
		onback,
		marks,
		sidebarOpen,
		ontogglesidebar,
		onshowmarks,
		tool,
		ontool,
		labels,
		lastLabel,
		onlabel,
		onrename,
		onresetnames,
		scrollMode,
		spreadMode,
		rotation,
		pageTheme,
		onscrollmode,
		onspreadmode,
		onrotate,
		onpagetheme
	}: Props = $props();

	/**
	 * The box is only bound to the real page while it is not being typed in.
	 *
	 * Binding it directly means the number is rewritten under the cursor on every
	 * scroll event, so typing "12" in a long paper is a race against the reader.
	 */
	let editing = $state(false);
	let draft = $state('');

	/**
	 * What the box says: the page the paper prints, when the file records one.
	 *
	 * A journal article beginning on page 843 calls its eleventh sheet 853, and
	 * 853 is the number a reader has in their hand when they want to get back to
	 * it — so that is what the box takes and what it shows. The sheet number is
	 * still there beside it, because scrolling is counted in sheets.
	 */
	const shown = $derived(editing ? draft : (pageLabel ?? String(page)));

	/** Shown only when the two disagree; otherwise it would read "4 4 of 20". */
	const showSheet = $derived(pageLabel !== null && pageLabel !== String(page));

	let query = $state('');
	let searchBox: HTMLInputElement | undefined = $state();

	function commit() {
		if (!editing) return;
		editing = false;
		ongoto(draft);
	}

	function onPageKey(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			(event.currentTarget as HTMLInputElement).blur();
			return;
		}
		if (event.key === 'Escape') {
			editing = false;
			(event.currentTarget as HTMLInputElement).blur();
		}
	}

	function onSearchKey(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			// Enter on an unchanged query means "next", which is what every other
			// find bar does and what the hands expect.
			onsearch(query, { again: true, backwards: event.shiftKey });
			return;
		}
		if (event.key === 'Escape') {
			query = '';
			onclosesearch();
		}
	}

	$effect(() => {
		if (searching) searchBox?.focus();
	});

	const plain =
		'text-ink-muted hover:bg-surface-hover hover:text-ink rounded p-1 transition-colors disabled:opacity-40 disabled:hover:bg-transparent';

	/** The colour a mark made now would take. */
	const colour = $derived(
		labels.find((label) => label.id === lastLabel)?.colour ??
			labels.find((label) => label.enabled)?.colour ??
			'45 90% 60%'
	);

	/**
	 * The tools, in Zotero's order, so a hand that knows one knows the other.
	 *
	 * `tinted` marks the two that put a colour on the page. A note takes the
	 * colour too, but it is drawn as a marker rather than over the words, and an
	 * icon tinted to match would read as a third marking mode.
	 */
	const tools = [
		{
			id: 'highlight' as const,
			icon: 'Highlighter' as const,
			on: 'Highlight as you select',
			off: 'Stop highlighting',
			tinted: true
		},
		{
			id: 'underline' as const,
			icon: 'Underline' as const,
			on: 'Underline as you select',
			off: 'Stop underlining',
			tinted: true
		},
		{
			id: 'note' as const,
			icon: 'StickyNote' as const,
			on: 'Leave a note on the page',
			off: 'Stop leaving notes',
			tinted: false
		},
		{
			id: 'area' as const,
			icon: 'Crop' as const,
			on: 'Keep a figure or table',
			off: 'Stop keeping figures',
			tinted: false
		}
	];
</script>

<div
	class="border-line bg-surface flex h-9 shrink-0 items-center gap-0.5 border-b px-2 text-xs select-none"
>
	<!-- ------------------------------------------------------- getting about -->
	<!--
		The panel every PDF reader has, where every PDF reader has it: pages,
		contents, marks. This used to be a marks-only toggle, which put a feature of
		this application in the place readers look for the paper's own furniture.
	-->
	<Tooltip label={sidebarOpen ? 'Hide the panel' : 'Pages, contents and marks'} side="bottom">
		{#snippet children(tooltip)}
			<button
				{...tooltip}
				class="rounded p-1 transition-colors {sidebarOpen
					? 'bg-surface-active text-ink'
					: 'text-ink-muted hover:bg-surface-hover hover:text-ink'}"
				aria-pressed={sidebarOpen}
				onclick={ontogglesidebar}
			>
				<Icon icon="PanelLeft" size="s" />
			</button>
		{/snippet}
	</Tooltip>

	<div class="bg-line mx-1 h-4 w-px" aria-hidden="true"></div>

	<Tooltip label="Zoom out" side="bottom">
		{#snippet children(tooltip)}
			<button {...tooltip} class={plain} onclick={() => onzoom(1 / 1.1)}>
				<Icon icon="ZoomOut" size="s" />
			</button>
		{/snippet}
	</Tooltip>

	<Tooltip label="Zoom in" side="bottom">
		{#snippet children(tooltip)}
			<button {...tooltip} class={plain} onclick={() => onzoom(1.1)}>
				<Icon icon="ZoomIn" size="s" />
			</button>
		{/snippet}
	</Tooltip>

	<!--
		The percentage doubles as the button that undoes it, which is where every
		reader looks first when a paper is too wide to read.
	-->
	<Tooltip label="Fit the page width ({Math.round(scale * 100)}%)" side="bottom">
		{#snippet children(tooltip)}
			<button {...tooltip} class="{plain} flex items-center gap-1 px-1.5" onclick={onfit}>
				<Icon icon="FitWidth" size="s" />
				<span class="tabular-nums">{Math.round(scale * 100)}%</span>
			</button>
		{/snippet}
	</Tooltip>

	<div class="bg-line mx-1 h-4 w-px" aria-hidden="true"></div>

	<!--
		Back to where a jump came from. Following a citation into page 41 and then
		having to find your way back to page 3 by hand is the thing that stops
		people following citations at all.
	-->
	<Tooltip label="Back to where you jumped from" side="bottom">
		{#snippet children(tooltip)}
			<button {...tooltip} class={plain} disabled={!canGoBack} onclick={onback}>
				<Icon icon="GoBack" size="s" />
			</button>
		{/snippet}
	</Tooltip>

	<div class="bg-line mx-1 h-4 w-px" aria-hidden="true"></div>

	<Tooltip label="Previous page" side="bottom">
		{#snippet children(tooltip)}
			<button {...tooltip} class={plain} disabled={page <= 1} onclick={() => onpage(page - 1)}>
				<Icon icon="ChevronUp" size="s" />
			</button>
		{/snippet}
	</Tooltip>

	<Tooltip label="Next page" side="bottom">
		{#snippet children(tooltip)}
			<button {...tooltip} class={plain} disabled={page >= pages} onclick={() => onpage(page + 1)}>
				<Icon icon="ChevronDown" size="s" />
			</button>
		{/snippet}
	</Tooltip>

	<div class="text-ink-muted ml-1 flex items-center gap-1">
		<input
			class="border-line bg-surface-sunken text-ink w-11 rounded border px-1 py-0.5 text-center"
			aria-label={pageLabel === null ? 'Page number' : 'Page number the paper prints'}
			title={pageLabel === null
				? 'Go to a page'
				: 'Go to a page. This paper prints its own numbers, and this is one of them.'}
			value={shown}
			oninput={(event) => {
				editing = true;
				draft = event.currentTarget.value;
			}}
			onblur={commit}
			onkeydown={onPageKey}
		/>
		<span class="whitespace-nowrap tabular-nums">
			{#if showSheet}({page})&nbsp;{/if}of&nbsp;{pages || '–'}
		</span>
	</div>

	<div class="grow"></div>

	<!-- ------------------------------------------------------------- the tools -->
	<!--
		`group` rather than `toolbar`: a toolbar promises arrow-key navigation
		between its controls, which these do not have. They are each tabbable,
		which is what `group` describes.
	-->
	<div class="flex items-center gap-0.5" role="group" aria-label="What to mark with">
		{#each tools as item (item.id)}
			{@const active = tool === item.id}
			<Tooltip label={active ? item.off : item.on} side="bottom">
				{#snippet children(tooltip)}
					<!--
						A latched marking tool is drawn in the colour it will mark with.

						Without it the toolbar says a tool is in hand but not what it
						would do, and the colour lives in a separate control — which
						reads as a second thing to choose before anything will happen.
						It has already been chosen; this is where that shows.
					-->
					<button
						{...tooltip}
						class="rounded p-1 transition-colors {active
							? 'bg-surface-active text-ink'
							: 'text-ink-muted hover:bg-surface-hover hover:text-ink'}"
						style:color={active && item.tinted ? `hsl(${colour})` : undefined}
						aria-pressed={active}
						onclick={() => ontool(active ? null : item.id)}
					>
						<Icon icon={item.icon} size="s" />
					</button>
				{/snippet}
			</Tooltip>
		{/each}

		<LabelPicker {labels} current={lastLabel} onchoose={onlabel} {onrename} {onresetnames} />
	</div>

	<div class="grow"></div>

	<!-- --------------------------------------------------------- how it looks -->
	{#if searching}
		<!--
			The count sits inside the field's row rather than in a popup, because
			"3 of 17" is the answer to the question being asked and hiding it behind
			a hover is how find bars become useless.
		-->
		<div class="flex items-center gap-1">
			<input
				bind:this={searchBox}
				bind:value={query}
				class="border-line bg-surface-sunken text-ink w-40 rounded border px-2 py-0.5"
				aria-label="Find in this paper"
				placeholder="Find…"
				oninput={() => onsearch(query)}
				onkeydown={onSearchKey}
			/>

			<span class="text-ink-muted w-16 tabular-nums">
				{#if query && find}
					{find.matches ? `${find.current} of ${find.matches}` : 'none'}
				{/if}
			</span>

			<Tooltip label="Previous match" side="bottom">
				{#snippet children(tooltip)}
					<button
						{...tooltip}
						class={plain}
						onclick={() => onsearch(query, { again: true, backwards: true })}
					>
						<Icon icon="ChevronUp" size="s" />
					</button>
				{/snippet}
			</Tooltip>

			<Tooltip label="Next match" side="bottom">
				{#snippet children(tooltip)}
					<button {...tooltip} class={plain} onclick={() => onsearch(query, { again: true })}>
						<Icon icon="ChevronDown" size="s" />
					</button>
				{/snippet}
			</Tooltip>

			<Tooltip label="Close find" side="bottom">
				{#snippet children(tooltip)}
					<button
						{...tooltip}
						class={plain}
						onclick={() => {
							query = '';
							onclosesearch();
						}}
					>
						<Icon icon="X" size="s" />
					</button>
				{/snippet}
			</Tooltip>
		</div>
	{:else}
		<!--
			The marks, on the right with the rest of what this application adds to a
			paper rather than in the panel button's place.
		-->
		<Tooltip
			label={marks === 1 ? '1 mark on this paper' : `${marks} marks on this paper`}
			side="bottom"
		>
			{#snippet children(tooltip)}
				<button
					{...tooltip}
					class="text-ink-muted hover:bg-surface-hover hover:text-ink flex items-center gap-1 rounded p-1 transition-colors"
					onclick={onshowmarks}
				>
					<Icon icon="Pencil" size="s" />
					{#if marks > 0}
						<span class="tabular-nums">{marks}</span>
					{/if}
				</button>
			{/snippet}
		</Tooltip>

		<AppearanceMenu
			{scrollMode}
			{spreadMode}
			{rotation}
			{pageTheme}
			onscroll={onscrollmode}
			onspread={onspreadmode}
			{onrotate}
			ontheme={onpagetheme}
		/>

		<Tooltip label="Find in this paper" side="bottom">
			{#snippet children(tooltip)}
				<button {...tooltip} class={plain} onclick={ontogglesearch}>
					<Icon icon="Search" size="s" />
				</button>
			{/snippet}
		</Tooltip>
	{/if}
</div>
