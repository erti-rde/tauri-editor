<script lang="ts">
	import ChevronDown from '~icons/lucide/chevron-down';
	import ChevronUp from '~icons/lucide/chevron-up';
	import GoBack from '~icons/lucide/corner-up-left';
	import Crop from '~icons/lucide/crop';
	import Highlighter from '~icons/lucide/highlighter';
	import PanelLeft from '~icons/lucide/panel-left';
	import Pencil from '~icons/lucide/pencil';
	import FitWidth from '~icons/lucide/scan';
	import Search from '~icons/lucide/search';
	import StickyNote from '~icons/lucide/sticky-note';
	import Underline from '~icons/lucide/underline';
	import ZoomIn from '~icons/lucide/zoom-in';
	import ZoomOut from '~icons/lucide/zoom-out';

	import {
		Button,
		FindBar,
		IconButton,
		TextField,
		ToggleButton,
		Toolbar,
		ToolbarGroup,
		Tooltip
	} from '$lib/ui';

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
	let findBar: FindBar | undefined = $state();

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

	$effect(() => {
		if (searching) findBar?.focus();
	});

	const status = $derived.by(() => {
		if (!query || !find) return '';
		return find.matches ? `${find.current} of ${find.matches}` : 'No matches';
	});

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
			icon: Highlighter,
			on: 'Highlight as you select',
			off: 'Stop highlighting',
			tinted: true
		},
		{
			id: 'underline' as const,
			icon: Underline,
			on: 'Underline as you select',
			off: 'Stop underlining',
			tinted: true
		},
		{
			id: 'note' as const,
			icon: StickyNote,
			on: 'Leave a note on the page',
			off: 'Stop leaving notes',
			tinted: false
		},
		{
			id: 'area' as const,
			icon: Crop,
			on: 'Keep a figure or table',
			off: 'Stop keeping figures',
			tinted: false
		}
	];
</script>

<!--
	One stop for Tab, with the arrows along it (`Toolbar`): the reader's controls
	are a dozen, and a reader tabbing to the paper went through every one.
-->
<Toolbar
	label="Reading"
	class="border-line bg-surface h-9 shrink-0 border-b px-2 text-xs select-none"
>
	<!-- ------------------------------------------------------- getting about -->
	<!--
		The panel every PDF reader has, where every PDF reader has it: pages,
		contents, marks. This used to be a marks-only toggle, which put a feature of
		this application in the place readers look for the paper's own furniture.
	-->
	<ToolbarGroup>
		<ToggleButton
			label={sidebarOpen ? 'Hide the panel' : 'Pages, contents and marks'}
			icon={PanelLeft}
			pressed={sidebarOpen}
			onclick={ontogglesidebar}
		/>
	</ToolbarGroup>

	<ToolbarGroup>
		<IconButton label="Zoom out" icon={ZoomOut} onclick={() => onzoom(1 / 1.1)} />
		<IconButton label="Zoom in" icon={ZoomIn} onclick={() => onzoom(1.1)} />
		<!--
			The percentage doubles as the button that undoes it, which is where every
			reader looks first when a paper is too wide to read.
		-->
		<Tooltip label="Fit the page width ({Math.round(scale * 100)}%)">
			{#snippet children(tooltip)}
				<Button {...tooltip} variant="ghost" class="tabular-nums" onclick={onfit}>
					<FitWidth class="size-4" aria-hidden="true" />
					{Math.round(scale * 100)}%
				</Button>
			{/snippet}
		</Tooltip>
	</ToolbarGroup>

	<!--
		Back to where a jump came from. Following a citation into page 41 and then
		having to find your way back to page 3 by hand is the thing that stops
		people following citations at all.
	-->
	<ToolbarGroup>
		<IconButton
			label="Back to where you jumped from"
			icon={GoBack}
			disabled={!canGoBack}
			onclick={onback}
		/>
	</ToolbarGroup>

	<ToolbarGroup>
		<IconButton
			label="Previous page"
			icon={ChevronUp}
			disabled={page <= 1}
			onclick={() => onpage(page - 1)}
		/>
		<IconButton
			label="Next page"
			icon={ChevronDown}
			disabled={page >= pages}
			onclick={() => onpage(page + 1)}
		/>
		<!-- A text box rather than a NumberField: it takes the page the paper
		     prints, which may be "xiv". -->
		<div class="text-ink-muted ml-1 flex items-center gap-1">
			<div class="w-12">
				<TextField
					label={pageLabel === null ? 'Page number' : 'Page number the paper prints'}
					hideLabel
					class="text-center"
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
			</div>
			<span class="whitespace-nowrap tabular-nums">
				{#if showSheet}({page})&nbsp;{/if}of&nbsp;{pages || '–'}
			</span>
		</div>
	</ToolbarGroup>

	<span class="grow" aria-hidden="true"></span>

	<!-- ------------------------------------------------------------- the tools -->
	<ToolbarGroup label="What to mark with" rule={false}>
		{#each tools as item (item.id)}
			{@const active = tool === item.id}
			<!--
				A latched marking tool is drawn in the colour it will mark with.

				Without it the toolbar says a tool is in hand but not what it would
				do, and the colour lives in a separate control — which reads as a
				second thing to choose before anything will happen. It has already
				been chosen; this is where that shows.
			-->
			<ToggleButton
				label={active ? item.off : item.on}
				icon={item.icon}
				pressed={active}
				style={active && item.tinted ? `color: hsl(${colour})` : undefined}
				onclick={() => ontool(active ? null : item.id)}
			/>
		{/each}

		<LabelPicker {labels} current={lastLabel} onchoose={onlabel} {onrename} {onresetnames} />
	</ToolbarGroup>

	<span class="grow" aria-hidden="true"></span>

	<!-- --------------------------------------------------------- how it looks -->
	<ToolbarGroup rule={false}>
		{#if searching}
			<FindBar
				bind:this={findBar}
				bind:query
				label="Find in this paper"
				{status}
				found={!!find?.matches}
				onquery={(text) => onsearch(text)}
				onstep={(direction) => onsearch(query, { again: true, backwards: direction < 0 })}
				onclose={() => {
					query = '';
					onclosesearch();
				}}
			/>
		{:else}
			<!--
				The marks, on the right with the rest of what this application adds to
				a paper rather than in the panel button's place.
			-->
			<Tooltip label={marks === 1 ? '1 mark on this paper' : `${marks} marks on this paper`}>
				{#snippet children(tooltip)}
					<Button {...tooltip} variant="ghost" class="tabular-nums" onclick={onshowmarks}>
						<Pencil class="size-4" aria-hidden="true" />
						{#if marks > 0}{marks}{/if}
					</Button>
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

			<IconButton label="Find in this paper" icon={Search} onclick={ontogglesearch} />
		{/if}
	</ToolbarGroup>
</Toolbar>
