<script module lang="ts">
	import { writable } from 'svelte/store';
	export type StatusType = {
		side: 'left' | 'right';
		message: string;
		type: 'info' | 'error';
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
	import { documentStatus } from './documentStatus';
	import { pageCount } from '$lib/editor/pagination/pageCount';
</script>

<div
	class="status-bar
    border-line
    bg-surface
    text-ink-muted
    flex
    items-center
    justify-between
    border-t
    px-3
    text-[11px]"
>
	<!-- Left: what the app is doing to your library. -->
	<div class="flex items-center gap-2">
		{#if $statusData}
			{#if $statusData.type === 'error'}
				<span class="error">X</span>
				{$statusData.message}
			{:else if $statusData.message}
				<span class="loader"></span>
				{$statusData.message}
			{/if}
		{/if}
	</div>

	<!-- Right: the manuscript. Glanced at rather than read, which is what a
	     status bar is for. -->
	<div class="flex items-center gap-4">
		{#if $documentStatus.words}
			<span
				class="font-mono"
				title="{$documentStatus.words
					.references} words in references and notes, which journal limits usually exclude"
			>
				{$documentStatus.words.body.toLocaleString()}
				{$documentStatus.words.body === 1 ? 'word' : 'words'}
				{#if $documentStatus.target > 0}
					<span class={$documentStatus.words.body > $documentStatus.target ? 'text-warning' : ''}>
						/ {$documentStatus.target.toLocaleString()}
					</span>
				{/if}
			</span>
		{/if}

		<!-- How long the thing actually is, in the unit a submission is measured
		     in. Gated on the same open-document signal as the save state. -->
		{#if $documentStatus.words !== null}
			<span class="font-mono">
				{$pageCount}
				{$pageCount === 1 ? 'page' : 'pages'}
			</span>
		{/if}

		<!-- Only once a manuscript is actually open. `clear()` resets save to
		     `idle`, which otherwise rendered a confident "Saved" on the landing
		     screen, about nothing. The word count is the open-document signal. -->
		{#if $documentStatus.words !== null}
			<span aria-live="polite">
				{#if $documentStatus.save === 'error'}
					<span class="text-danger font-medium">Not saved — retrying</span>
				{:else if $documentStatus.save === 'saving'}
					Saving…
				{:else if $documentStatus.save === 'pending'}
					<span class="text-ink-muted">Unsaved</span>
				{:else}
					<span class="text-ink-muted">Saved</span>
				{/if}
			</span>
		{/if}
	</div>
</div>

<style>
	.status-bar {
		height: var(--footer-status-bar-height);
	}
	.error {
		color: hsl(var(--danger));
		font-weight: 800;
	}
	.loader {
		width: 20px;
		height: 20px;
		border: 2px solid hsl(var(--ink-muted));
		border-bottom-color: transparent;
		border-radius: 50%;
		display: inline-block;
		box-sizing: border-box;
		animation: rotation 1s linear infinite;
	}

	@keyframes rotation {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}
</style>
