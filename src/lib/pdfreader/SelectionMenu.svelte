<script lang="ts">
	import Icon from '$lib/icon/Icon.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';

	import type { ClientRectLike } from './location';
	import type { AnnotationLabel, MarkStyle } from '$lib/stores/db';

	/**
	 * What to do with the words just selected.
	 *
	 * Built on the shape Zotero's selection popup has, because it is the right
	 * one: the colours come first and clicking one *is* the highlight, so marking
	 * a passage in a colour is a single act rather than a choice followed by a
	 * confirmation. The two mode buttons sit joined beside them, saying what that
	 * click will draw.
	 *
	 * Where Erti differs is that its colours mean something. Zotero's are called
	 * Yellow and Red; these are the reader's own — Claim, Limitation, whatever
	 * they have renamed them to — so every swatch carries its name, and a row of
	 * anonymous squares is exactly what this must not be.
	 *
	 * Positioned in the scrolling container's content coordinates, so it stays
	 * attached to the words if the page moves under it.
	 */
	interface Props {
		at: ClientRectLike;
		labels: AnnotationLabel[];
		lastLabel: string | null;
		/** How the mark will be drawn, so the popup shows what you will get. */
		markStyle: MarkStyle;
		onstyle: (style: MarkStyle) => void;
		onhighlight: (labelId: string | null) => void;
		onnote: (labelId: string | null) => void;
		oncopy: () => void;
		onclose: () => void;
		/** Whether there is room above the passage on screen. */
		preferAbove: boolean;
	}

	const {
		at,
		labels,
		lastLabel,
		markStyle,
		onstyle,
		onhighlight,
		onnote,
		oncopy,
		onclose,
		preferAbove
	}: Props = $props();

	const usable = $derived(labels.filter((label) => label.enabled));
	const current = $derived(usable.find((label) => label.id === lastLabel) ?? usable[0]);

	/**
	 * Above the passage when there is room, below it otherwise.
	 *
	 * A popup under the selection covers the next line, which is the line you
	 * were about to read. Zotero's popup prefers the top for the same reason.
	 *
	 * Whether there is room is a question about the screen, not about the paper,
	 * so the reader answers it — this card is positioned in the scrolling
	 * content's coordinates, where "near the top" and "near the top of the
	 * window" are different numbers once anything has been scrolled.
	 */
	const above = $derived(preferAbove);
</script>

<!--
	`group` rather than `toolbar`: a toolbar promises arrow-key navigation between
	its controls, and Phase 6 spent real effort removing exactly that claim from
	places that did not honour it. These buttons are each tabbable, which is what
	`group` describes.

	The pointer is stopped from reaching the pages underneath, because pressing a
	button here must not clear the very selection the button is about to act on.
-->
<div
	class="erti-popup absolute z-20"
	class:erti-popup-above={above}
	style:left="{at.left}px"
	style:top="{above ? at.top - 10 : at.top + at.height + 10}px"
	role="group"
	aria-label="What to do with the selected passage"
	data-selection-menu
	onpointerdown={(event) => event.preventDefault()}
>
	<div
		class="border-line bg-surface-overlay flex items-center gap-1 rounded-md border p-1 shadow-lg"
	>
		<!--
			Clicking a colour marks the passage in it. There is no separate confirm,
			because the colour *is* the decision — and a popup that asks twice for
			one intention is how a hundred highlights an afternoon becomes a chore.
		-->
		{#each usable as label (label.id)}
			<Tooltip label={`${markStyle === 'fill' ? 'Highlight' : 'Underline'} as ${label.name}`}>
				{#snippet children(tooltip)}
					<button
						{...tooltip}
						class="erti-swatch rounded-full"
						style:--swatch="hsl({label.colour})"
						onclick={() => onhighlight(label.id)}
					></button>
				{/snippet}
			</Tooltip>
		{/each}

		<div class="bg-line mx-0.5 h-5 w-px" aria-hidden="true"></div>

		<!--
			Highlight or underline: the same passage either way, and readers reach
			for both the way they reach for two pens. Joined into one control so it
			reads as one exclusive choice rather than two independent buttons.
		-->
		<div
			class="border-line flex overflow-hidden rounded border"
			role="group"
			aria-label="How to mark"
		>
			<button
				class="px-1.5 py-1 transition-colors {markStyle === 'fill'
					? 'bg-surface-active text-ink'
					: 'text-ink-muted hover:bg-surface-hover hover:text-ink'}"
				onclick={() => onstyle('fill')}
				aria-pressed={markStyle === 'fill'}
				title="Highlight the words"
				aria-label="Highlight the words"
				style:color={markStyle === 'fill' ? `hsl(${current?.colour ?? '45 90% 60%'})` : undefined}
			>
				<Icon icon="Highlighter" size="s" />
			</button>

			<button
				class="px-1.5 py-1 transition-colors {markStyle === 'underline'
					? 'bg-surface-active text-ink'
					: 'text-ink-muted hover:bg-surface-hover hover:text-ink'}"
				onclick={() => onstyle('underline')}
				aria-pressed={markStyle === 'underline'}
				title="Underline the words"
				aria-label="Underline the words"
				style:color={markStyle === 'underline'
					? `hsl(${current?.colour ?? '45 90% 60%'})`
					: undefined}
			>
				<Icon icon="Underline" size="s" />
			</button>
		</div>

		<div class="bg-line mx-0.5 h-5 w-px" aria-hidden="true"></div>

		<Tooltip label="Mark it and write a note">
			{#snippet children(tooltip)}
				<button
					{...tooltip}
					class="text-ink-muted hover:bg-surface-hover hover:text-ink rounded p-1 transition-colors"
					onclick={() => onnote(current?.id ?? null)}
				>
					<Icon icon="Pencil" size="s" />
				</button>
			{/snippet}
		</Tooltip>

		<Tooltip label="Copy the passage">
			{#snippet children(tooltip)}
				<button
					{...tooltip}
					class="text-ink-muted hover:bg-surface-hover hover:text-ink rounded p-1 transition-colors"
					onclick={oncopy}
				>
					<Icon icon="Quote" size="s" />
				</button>
			{/snippet}
		</Tooltip>

		<button class="sr-only" onclick={onclose}>Leave it unmarked</button>
	</div>
</div>

<style>
	/*
	  A pointer at the passage.

	  Without it the card floats near the words rather than belonging to them,
	  which matters here more than it usually would: several marks can sit within
	  a line of each other, and a popup that could be about any of them is a
	  popup you have to think about.
	*/
	.erti-popup {
		filter: drop-shadow(0 1px 2px hsl(0 0% 0% / 0.12));
	}

	.erti-popup-above {
		transform: translateY(-100%);
	}

	.erti-popup::after {
		content: '';
		position: absolute;
		left: 14px;
		width: 10px;
		height: 10px;
		background: hsl(var(--surface-overlay));
		border: 1px solid hsl(var(--line));
		transform: rotate(45deg);
	}

	.erti-popup:not(.erti-popup-above)::after {
		top: -5px;
		border-right: 0;
		border-bottom: 0;
	}

	.erti-popup-above::after {
		bottom: -5px;
		border-top: 0;
		border-left: 0;
	}

	/*
	  Round rather than square, and larger than a toolbar icon. These are the
	  primary control of this popup — the thing the hand is aiming at a hundred
	  times an afternoon — so they are sized to be hit rather than to be tidy.
	*/
	.erti-swatch {
		width: 1.25rem;
		height: 1.25rem;
		padding: 0;
		border: 0;
		background: var(--swatch);
		box-shadow: inset 0 0 0 1px hsl(0 0% 0% / 0.15);
		transition:
			transform 100ms ease,
			box-shadow 100ms ease;
	}

	.erti-swatch:hover {
		transform: scale(1.12);
	}

	/*
	  No colour is ringed as the chosen one.

	  A ring here read as "this passage is already this colour" over a passage
	  that had been marked with nothing at all — the popup is asking a question,
	  and drawing part of it as already answered is the wrong thing to say.
	  Zotero's is a plain row of colours for the same reason: clicking one *is*
	  the answer, so there is no state to show before it is clicked.
	*/
</style>
