<script lang="ts">
	import ChevronDown from '~icons/lucide/chevron-down';
	import ChevronRight from '~icons/lucide/chevron-right';

	import { Banner, Button, EmptyState, Item, Panel } from '$lib/ui';

	import { attributionCheck as check, type FixAction, type ShownFinding } from './check.svelte';
	import * as copy from './copy';

	/**
	 * Check attribution (M4-5, docs/ux.md UX-7): a review the writer runs, with
	 * the source open beside the sentence.
	 *
	 * It says what the words match and nothing about the writer: no score, no
	 * percentage, no colour for severity. It runs only when asked (AC-6). Every
	 * word it shows is in `copy.ts`, where a test holds them to the principles.
	 */

	const result = $derived(check.current);
	const groups = $derived(check.groups);
	const dismissed = $derived(check.dismissedFindings);
	let showDismissed = $state(false);

	const FIX_LABELS: Record<FixAction, string> = {
		quoteAndCite: copy.ACTIONS.quoteAndCite,
		cite: copy.ACTIONS.cite,
		blockQuote: copy.ACTIONS.blockQuote,
		useSourceWords: copy.ACTIONS.useSourceWords
	};

	/** The source, its page, and what differs, as one line. */
	const metaOf = (f: ShownFinding) =>
		[f.source, f.page && copy.PAGE(f.page), f.detail].filter(Boolean).join(' · ');

	/** A finding's words, in quotation marks: they are the writer's, as written. */
	const quoted = (f: ShownFinding) => `“${f.excerpt}”`;

	const headingId = (kind: string) => `check-${kind}`;

	const run = () => void check.run();
	const choose = (f: ShownFinding) => check.select(check.selected === f.id ? null : f);
</script>

{#snippet finding(f: ShownFinding, set: 'shown' | 'dismissed')}
	<Item
		text={quoted(f)}
		clamp
		onselect={set === 'shown' ? () => choose(f) : undefined}
		selected={check.selected === f.id}
	>
		{#snippet meta()}
			<span class="truncate">{metaOf(f)}</span>
		{/snippet}
		{#snippet actions()}
			{#if set === 'shown'}
				{#each f.fixes as fix (fix)}
					<Button
						variant="ghost"
						size="sm"
						loading={check.fixing === f.id}
						disabled={check.fixing !== null}
						onclick={() => void check.fix(f, fix)}
					>
						{FIX_LABELS[fix]}
					</Button>
				{/each}
				{#if f.passage.file}
					<Button variant="ghost" size="sm" onclick={() => void check.showSource(f)}>
						{copy.ACTIONS.showSource}
					</Button>
				{/if}
				<Button variant="ghost" size="sm" onclick={() => void check.dismiss(f)}>
					{copy.ACTIONS.dismiss}
				</Button>
			{:else}
				<Button variant="ghost" size="sm" onclick={() => void check.restore(f)}>
					{copy.ACTIONS.restore}
				</Button>
			{/if}
		{/snippet}
	</Item>
{/snippet}

<Panel
	title={copy.TITLE}
	scope={result && !result.tooShort
		? copy.scopeLine({
				sentences: result.sentences,
				sources: result.sources,
				documents: result.documents
			})
		: undefined}
>
	{#snippet action()}
		<Button
			variant="primary"
			size="sm"
			loading={check.running}
			disabled={!check.editor || check.running}
			onclick={run}
		>
			{check.running ? copy.RUNNING : copy.RUN}
		</Button>
	{/snippet}

	{#if !check.editor}
		<EmptyState message={copy.NO_DOCUMENT} />
	{:else if check.failure}
		<EmptyState
			message={copy.FAILED}
			detail={check.failure}
			action={{ label: copy.RUN_AGAIN, onclick: run }}
		/>
	{:else if !result}
		<EmptyState message={copy.NOT_RUN} detail={copy.NOT_RUN_DETAIL} />
	{:else if result.tooShort}
		<EmptyState message={copy.TOO_SHORT} detail={copy.TOO_SHORT_DETAIL} />
	{:else}
		{#if check.stale}
			<!-- Old findings stay, dimmed: still worth reading, no longer exact (AC-5). -->
			<div class="p-2">
				<Banner action={{ label: copy.RUN_AGAIN, onclick: run }}>{copy.STALE}</Banner>
			</div>
		{/if}

		<div class={[check.stale && 'opacity-60']} data-stale={check.stale || undefined}>
			{#if groups.length === 0}
				<EmptyState message={copy.NOTHING_TO_REVIEW} detail={copy.NOTHING_TO_REVIEW_DETAIL} />
			{/if}

			{#each groups as group (group.kind)}
				{@const heading = headingId(group.kind)}
				<section aria-labelledby={heading}>
					<h3
						id={heading}
						class="text-caption text-ink-muted flex gap-1.5 px-3 pt-3 pb-1 font-semibold"
					>
						<span class="flex-1">{copy.GROUP_TITLES[group.kind]}</span>
						<span>{group.findings.length}</span>
					</h3>
					{#each group.findings as f (f.id)}
						{@render finding(f, 'shown')}
					{/each}
				</section>
			{/each}

			{#if dismissed.length > 0}
				<section class="pt-2">
					<Button
						variant="ghost"
						size="sm"
						class="ml-1"
						aria-expanded={showDismissed}
						onclick={() => (showDismissed = !showDismissed)}
					>
						{#if showDismissed}
							<ChevronDown class="size-3.5" aria-hidden="true" />
						{:else}
							<ChevronRight class="size-3.5" aria-hidden="true" />
						{/if}
						{copy.DISMISSED(dismissed.length)}
					</Button>
					{#if showDismissed}
						{#each dismissed as f (f.id)}
							{@render finding(f, 'dismissed')}
						{/each}
					{/if}
				</section>
			{/if}
		</div>
	{/if}
</Panel>
