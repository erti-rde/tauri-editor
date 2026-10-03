<script lang="ts">
	import Icon from '$lib/icon/Icon.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';

	import AnnotationSidebar from './AnnotationSidebar.svelte';

	import type { Annotation, AnnotationLabel } from '$lib/stores/db';
	import type { OutlineItem } from './viewer';
	import { log } from '$lib/log';

	/**
	 * The panel a PDF reader has.
	 *
	 * Three answers to "where am I and where else could I be": the pages as
	 * pictures, the paper's own table of contents, and what has been marked on
	 * it. Every reader a researcher already uses has the first two — Preview,
	 * Acrobat, Zotero — and their absence is felt immediately in a hundred-page
	 * thesis, where the only way about was the page box.
	 *
	 * One panel with tabs rather than three toggles, because they answer the same
	 * question and only one of them can usefully be on screen in 18rem.
	 */
	export type SidebarTab = 'thumbnails' | 'contents' | 'marks';

	interface Props {
		tab: SidebarTab;
		ontab: (tab: SidebarTab) => void;
		pages: number;
		page: number;
		/** What the paper calls each sheet, when it says. */
		pageLabels: (string | null)[] | null;
		outline: OutlineItem[];
		/** Draw one page small. Null when it cannot be drawn. */
		thumbnail: (page: number, width: number) => Promise<string | null>;
		/** Bumped when the document changes, so cached pictures are dropped. */
		revision: number;
		onpage: (page: number) => void;
		onoutline: (dest: unknown) => void;
		annotations: Annotation[];
		labels: AnnotationLabel[];
		reveal: string | null;
		onjump: (annotation: Annotation) => void;
		ondelete: (id: string) => void;
		onnote: (annotation: Annotation, note: string) => void;
		onlabel: (annotation: Annotation, labelId: string | null) => void;
	}

	const {
		tab,
		ontab,
		pages,
		page,
		pageLabels,
		outline,
		thumbnail,
		revision,
		onpage,
		onoutline,
		annotations,
		labels,
		reveal,
		onjump,
		ondelete,
		onnote,
		onlabel
	}: Props = $props();

	const THUMBNAIL_WIDTH = 120;

	/**
	 * Pictures already drawn.
	 *
	 * Drawing a page costs a full render, so a three-hundred-page thesis cannot
	 * draw them all — they are drawn as they scroll into view and kept. A plain
	 * object rather than a Map so Svelte's own reactivity carries it.
	 */
	let pictures = $state<Record<string, string>>({});

	/**
	 * Pages with a render in flight, so a frame scrolled past twice is drawn
	 * once. A plain object rather than a `Set`: nothing here is reactive, and a
	 * bare `Set` in a component reads to the linter as reactive state that forgot
	 * to be — a warning worth keeping rather than silencing.
	 */
	let drawing: Record<number, true> = {};

	// A new document means new pictures; keeping the old ones would show the
	// previous paper's pages under this one's numbers.
	$effect(() => {
		void revision;
		pictures = {};
		drawing = {};
	});

	async function draw(n: number) {
		const key = `${revision}:${n}`;
		if (pictures[key] || drawing[n]) return;

		drawing[n] = true;
		try {
			const url = await thumbnail(n, THUMBNAIL_WIDTH);
			if (url) pictures = { ...pictures, [key]: url };
		} catch (failure) {
			// A page that will not draw leaves an empty frame with its number on
			// it, which is still a place to click.
			log.error('Could not draw that page small', failure);
		} finally {
			delete drawing[n];
		}
	}

	/**
	 * Draw a page when its frame comes into view.
	 *
	 * An action rather than a scroll handler: the observer answers exactly the
	 * question being asked, and stops asking once the page is drawn.
	 */
	function whenSeen(node: HTMLElement, n: number) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void draw(n);
			},
			{ rootMargin: '200px' }
		);
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}

	const sheets = $derived(Array.from({ length: pages }, (_, index) => index + 1));

	const tabs = [
		{ id: 'thumbnails' as const, icon: 'Files' as const, name: 'Pages' },
		{ id: 'contents' as const, icon: 'ListTree' as const, name: 'Contents' },
		{ id: 'marks' as const, icon: 'Pencil' as const, name: 'Marks' }
	];

	/** What to call a sheet: the number the paper prints, or the sheet's own. */
	function nameOf(n: number): string {
		return pageLabels?.[n - 1] ?? String(n);
	}
</script>

<aside class="border-line bg-surface flex w-64 shrink-0 flex-col border-r" aria-label="This paper">
	<div class="border-line flex shrink-0 border-b" role="tablist" aria-label="What to show">
		{#each tabs as item (item.id)}
			<Tooltip label={item.name} side="bottom">
				{#snippet children(tooltip)}
					<button
						{...tooltip}
						role="tab"
						aria-selected={tab === item.id}
						class="flex grow items-center justify-center py-1.5 transition-colors {tab === item.id
							? 'border-accent text-ink border-b-2'
							: 'text-ink-muted hover:bg-surface-hover hover:text-ink border-b-2 border-transparent'}"
						onclick={() => ontab(item.id)}
					>
						<Icon icon={item.icon} size="s" />
					</button>
				{/snippet}
			</Tooltip>
		{/each}
	</div>

	{#if tab === 'thumbnails'}
		<div class="min-h-0 grow overflow-auto p-2" role="tabpanel" aria-label="Pages">
			{#if pages === 0}
				<p class="text-ink-muted p-2 text-xs">No pages yet.</p>
			{/if}

			{#each sheets as n (n)}
				<button
					class="mx-auto mb-2 block w-full text-center"
					onclick={() => onpage(n)}
					aria-label="Go to page {nameOf(n)}"
					aria-current={n === page ? 'page' : undefined}
					use:whenSeen={n}
				>
					<span
						class="mx-auto block overflow-hidden rounded-sm border transition-colors {n === page
							? 'border-accent'
							: 'border-line hover:border-ink-faint'}"
						style:width="{THUMBNAIL_WIDTH}px"
					>
						{#if pictures[`${revision}:${n}`]}
							<img
								src={pictures[`${revision}:${n}`]}
								alt=""
								class="block w-full"
								draggable="false"
							/>
						{:else}
							<!-- The frame is there before the picture is, so the list does
							     not jump about as pages arrive. -->
							<span
								class="bg-surface-sunken block"
								style:height="{Math.round(THUMBNAIL_WIDTH * 1.294)}px"
							></span>
						{/if}
					</span>
					<span
						class="mt-0.5 block text-[11px] tabular-nums {n === page
							? 'text-ink'
							: 'text-ink-muted'}"
					>
						{nameOf(n)}
					</span>
				</button>
			{/each}
		</div>
	{:else if tab === 'contents'}
		<div class="min-h-0 grow overflow-auto py-1" role="tabpanel" aria-label="Contents">
			{#if outline.length === 0}
				<p class="text-ink-muted p-3 text-xs">
					This paper carries no table of contents. Most scans do not; most typeset papers do.
				</p>
			{:else}
				{#snippet branch(items: OutlineItem[], depth: number)}
					{#each items as item (item.title + depth)}
						<button
							class="hover:bg-surface-hover text-ink focus-inset block w-full truncate px-3 py-1 text-left text-xs"
							style:padding-left="{0.75 + depth * 0.75}rem"
							onclick={() => onoutline(item.dest)}
						>
							{item.title}
						</button>
						{#if item.children.length > 0}
							{@render branch(item.children, depth + 1)}
						{/if}
					{/each}
				{/snippet}

				{@render branch(outline, 0)}
			{/if}
		</div>
	{:else}
		<!--
			The marks panel, unchanged and simply moved in here. It was a fourth
			thing beside the paper; it is one of the three answers to the same
			question, and belongs with them.
		-->
		<div class="min-h-0 grow overflow-hidden" role="tabpanel" aria-label="Marks">
			<AnnotationSidebar
				{annotations}
				{labels}
				{reveal}
				{onjump}
				{ondelete}
				{onnote}
				{onlabel}
				embedded
			/>
		</div>
	{/if}
</aside>
