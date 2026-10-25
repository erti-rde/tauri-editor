<script module lang="ts">
	import { writable } from 'svelte/store';
	export type StatusType = {
		side: 'left' | 'right';
		message: string;
		/** Under way, finished, or failed. Each has its own icon as well as its words. */
		type: 'info' | 'done' | 'error';
	};

	const statusData = writable<StatusType | undefined>({
		side: 'left',
		message: '',
		type: 'info'
	});

	export function setStatus(status: StatusType) {
		statusData.set(status);
	}

	export function removeStatus() {
		statusData.set(undefined);
	}
</script>

<script lang="ts">
	import { StatusItem } from '$lib/ui';
	import { documentStatus } from './documentStatus';
	import { pageCount } from '$lib/editor/pagination/pageCount';

	const over = $derived(
		$documentStatus.words && $documentStatus.target > 0
			? $documentStatus.words.body - $documentStatus.target
			: 0
	);
</script>

<div
	class="border-line bg-surface text-ink-muted text-caption flex h-(--footer-status-bar-height) items-center justify-between gap-4 border-t px-3"
>
	<!-- Left: what the app is doing to your library. -->
	<div class="flex min-w-0 items-center gap-2">
		{#if $statusData?.message}
			<StatusItem
				tone={$statusData.type === 'error'
					? 'danger'
					: $statusData.type === 'done'
						? 'success'
						: 'busy'}
			>
				<span class="truncate">{$statusData.message}</span>
			</StatusItem>
		{/if}
	</div>

	<!-- Right: the manuscript. Glanced at rather than read, which is what a
	     status bar is for. -->
	<div class="flex items-center gap-4">
		{#if $documentStatus.words}
			<!-- Over the target is said in words, not only by the icon's colour. -->
			<StatusItem
				tone={over > 0 ? 'warning' : 'neutral'}
				title="{$documentStatus.words
					.references} words in references and notes, which journal limits usually exclude"
			>
				{$documentStatus.words.body.toLocaleString()}
				{$documentStatus.words.body === 1 ? 'word' : 'words'}
				{#if $documentStatus.target > 0}
					/ {$documentStatus.target.toLocaleString()}{#if over > 0}, {over.toLocaleString()} over{/if}
				{/if}
			</StatusItem>
		{/if}

		<!-- How long the thing actually is, in the unit a submission is measured
		     in. Gated on the same open-document signal as the save state. -->
		{#if $documentStatus.words !== null}
			<StatusItem>
				{$pageCount}
				{$pageCount === 1 ? 'page' : 'pages'}
			</StatusItem>
		{/if}

		<!-- Only once a manuscript is actually open. `clear()` resets save to
		     `idle`, which otherwise rendered a confident "Saved" on the landing
		     screen, about nothing. The word count is the open-document signal. -->
		{#if $documentStatus.words !== null}
			<span aria-live="polite">
				{#if $documentStatus.save === 'error'}
					<StatusItem tone="danger">Not saved — retrying</StatusItem>
				{:else if $documentStatus.save === 'saving'}
					<StatusItem tone="busy">Saving…</StatusItem>
				{:else if $documentStatus.save === 'pending'}
					<StatusItem>Unsaved</StatusItem>
				{:else}
					<StatusItem tone="success">Saved</StatusItem>
				{/if}
			</span>
		{/if}
	</div>
</div>
