<script lang="ts">
	import { computePosition, flip, offset, shift } from '@floating-ui/dom';
	import { onDestroy } from 'svelte';

	import { parseCitationIds } from '$lib/citations/document';
	import { guardCslItem } from '$lib/guard';
	import { addSourceFromManuscript } from '$lib/stores/db';
	import { citationStore } from '$lib/stores/citationStore';
	import { errorToast, successToast } from '$lib/toast/Toast.svelte';

	/**
	 * What a citation from the manuscript's own sources says about itself
	 * (M1a-8, UX-12).
	 *
	 * The citation renders normally, with a dotted underline: the source came
	 * with the file, from a co-author who has the paper, and this library
	 * doesn't. Nothing is wrong, so nothing is red. Pointing at it (or selecting
	 * it) says where it comes from and offers to keep it.
	 *
	 * Hand-built from tokens because there's no Popover primitive yet; M1c-3
	 * brings one, and this moves onto it.
	 */

	interface Props {
		/** The element the manuscript renders into. */
		root: HTMLElement | undefined;
		/** Re-render citations after the library changes. */
		onadded: () => void;
	}

	const { root, onadded }: Props = $props();

	let target = $state<HTMLElement | null>(null);
	let tip = $state<HTMLElement | undefined>();
	let busy = $state(false);
	let hideTimer: ReturnType<typeof setTimeout> | undefined;

	const awayCitation = (node: EventTarget | null) =>
		node instanceof Element ? node.closest<HTMLElement>('[data-type="citation"][data-away]') : null;

	function show(span: HTMLElement) {
		clearTimeout(hideTimer);
		target = span;
	}

	/** After a moment, so the pointer can cross from the citation to the tip. */
	function hideSoon() {
		clearTimeout(hideTimer);
		hideTimer = setTimeout(() => {
			if (!busy) target = null;
		}, 250);
	}

	$effect(() => {
		if (!root) return;
		const over = (event: Event) => {
			const span = awayCitation(event.target);
			if (span) show(span);
		};
		const out = (event: Event) => {
			if (awayCitation(event.target)) hideSoon();
		};
		// A citation selected with the keyboard gets the same tip.
		const selected = new MutationObserver(() => {
			const span = root.querySelector<HTMLElement>(
				'[data-type="citation"][data-away].ProseMirror-selectednode'
			);
			if (span) show(span);
		});
		root.addEventListener('mouseover', over);
		root.addEventListener('mouseout', out);
		selected.observe(root, { subtree: true, attributes: true, attributeFilter: ['class'] });
		return () => {
			root.removeEventListener('mouseover', over);
			root.removeEventListener('mouseout', out);
			selected.disconnect();
		};
	});

	$effect(() => {
		if (!target || !tip) return;
		const floating = tip;
		void computePosition(target, floating, {
			placement: 'bottom-start',
			middleware: [offset(6), flip(), shift({ padding: 8 })]
		}).then(({ x, y }) => {
			floating.style.left = `${x}px`;
			floating.style.top = `${y}px`;
		});
	});

	async function add() {
		if (!target) return;
		busy = true;
		const ids = parseCitationIds(target.dataset.id).filter((id) => citationStore.isAway(id));
		const sources = citationStore.getAllSourcesAsJson();
		try {
			for (const id of ids) {
				// Checked as CSL before it goes anywhere: the snapshot came in a file.
				const csl = { ...guardCslItem(sources[id]), id };
				await addSourceFromManuscript(id, JSON.stringify(csl));
			}
			await citationStore.initializeCitationStore();
			onadded();
			successToast(
				ids.length === 1 ? 'Added to your library.' : `Added ${ids.length} sources to your library.`
			);
			target = null;
		} catch (error) {
			errorToast(
				`Could not add it to your library: ${error instanceof Error ? error.message : String(error)}`
			);
		} finally {
			busy = false;
		}
	}

	onDestroy(() => clearTimeout(hideTimer));
</script>

{#if target}
	<div
		bind:this={tip}
		role="dialog"
		aria-label="Source from the manuscript"
		class="border-line bg-surface-overlay text-ink fixed z-30 flex items-center gap-3 rounded border px-3 py-2 text-xs shadow-lg"
		onmouseenter={() => clearTimeout(hideTimer)}
		onmouseleave={hideSoon}
	>
		<span class="text-ink-muted">From the manuscript: not in your library</span>
		<button
			type="button"
			class="text-accent hover:text-accent-hover font-medium disabled:opacity-60"
			onclick={add}
			disabled={busy}
		>
			{busy ? 'Adding…' : 'Add to library'}
		</button>
	</div>
{/if}
