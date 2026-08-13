<script lang="ts">
	import { onDestroy } from 'svelte';

	import { invoke } from '@tauri-apps/api/core';

	/**
	 * Which PDF to show, rather than "the" PDF.
	 *
	 * This read the one globally-current file, which meant exactly one PDF could
	 * be on screen — so it could not be a tab, and two papers could not be read
	 * side by side.
	 */
	interface Props {
		path: string;
	}

	const { path }: Props = $props();

	let pdfUrl = $state('');
	let loading = $state(false);
	let error: string | null = $state(null);
	let currentPath: string | null = $state(null);

	/**
	 * Which load is the current one.
	 *
	 * Switching tabs quickly starts a second read before the first returns, and
	 * without this the slower one wins and the pane shows the paper you just
	 * navigated away from.
	 */
	let generation = 0;

	onDestroy(() => {
		// Each load makes a blob URL, and the browser keeps the bytes alive until
		// it is revoked. A few dozen papers over a session is real memory.
		generation++;
		if (pdfUrl) URL.revokeObjectURL(pdfUrl);
	});

	$effect(() => {
		if (path && currentPath !== path) void renderPdf(path);
	});

	async function renderPdf(pdfPath: string) {
		const mine = ++generation;

		loading = true;
		error = null;
		currentPath = pdfPath;

		try {
			// Awaited, so a failure lands in the catch below. This used to call
			// `.then()` inside a try block, which cannot catch an async rejection —
			// so a PDF that would not read surfaced as an unhandled rejection and
			// the reader sat on an empty viewer instead of saying what went wrong.
			const encoded = await invoke<string>('read_pdf_file', { path: pdfPath });
			if (mine !== generation) return;

			const blob = new Blob([base64ToUint8Array(encoded)], { type: 'application/pdf' });
			const next = URL.createObjectURL(blob);

			if (pdfUrl) URL.revokeObjectURL(pdfUrl);
			pdfUrl = next;
		} catch (e) {
			if (mine !== generation) return;

			console.error('Could not open the PDF:', e);
			error = e instanceof Error ? e.message : String(e);
			// Cleared so the same file can be tried again; leaving it set made a
			// failed paper permanently unopenable until the tab was closed.
			currentPath = null;
		} finally {
			if (mine === generation) loading = false;
		}
	}

	function base64ToUint8Array(base64String: string) {
		const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
		const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
		const rawData = window.atob(base64);
		const outputArray = new Uint8Array(rawData.length);
		for (let i = 0; i < rawData.length; ++i) {
			outputArray[i] = rawData.charCodeAt(i);
		}
		return outputArray;
	}
</script>

<div class="flex h-full w-full flex-col items-center">
	{#if error}
		<div class="error">{error}</div>
	{:else if loading || !pdfUrl}
		<!--
			`!pdfUrl` matters as much as `loading`. The viewer was mounted before
			the bytes arrived, with `?file=` empty, and failed to load nothing —
			which is the error that reached the user.
		-->
		<div class="loading">Loading PDF…</div>
	{:else}
		<div class="h-full w-full overflow-auto">
			<iframe
				title="pdf-reader"
				src={`/pdfjs/viewer/viewer.html?file=${encodeURIComponent(pdfUrl)}`}
				width="100%"
				height="100%"
				style="border: none;"
			></iframe>
		</div>
	{/if}
</div>

<style>
	.loading,
	.error {
		padding: 1rem;
		text-align: center;
	}

	.error {
		color: hsl(var(--danger));
	}
</style>
