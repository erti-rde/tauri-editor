<script lang="ts">
	import { onMount } from 'svelte';

	import { invoke } from '@tauri-apps/api/core';
	import { fileSystemState } from '$lib/stores/fileSystem.svelte';

	let pdfUrl = $state('');
	let loading = $state(false);
	let error: string | null = $state(null);
	let mounted = $state(false);
	let currentPath: string | null = $state(null); // Track current PDF path

	onMount(() => {
		mounted = true;
		return () => {
			mounted = false;
		};
	});

	$effect(() => {
		if (fileSystemState.currentFile && currentPath !== fileSystemState.currentFile) {
			renderPdf(fileSystemState.currentFile);
		}
	});

	async function renderPdf(pdfPath: string) {
		// Prevent re-rendering the same PDF
		if (currentPath === pdfPath || !mounted) {
			return;
		}

		loading = true;
		error = null;
		currentPath = pdfPath;

		try {
			// Get base64 encoded PDF data from Tauri backend
			invoke('read_pdf_file', { path: pdfPath }).then((res) => {
				const uint8Array = base64ToUint8Array(res as string);
				const blob = new Blob([uint8Array], { type: 'application/pdf' });
				pdfUrl = URL.createObjectURL(blob);
			});
		} catch (e) {
			if (mounted) {
				console.error('Error rendering PDF:', e);
				error = e instanceof Error ? e.message : 'Failed to render PDF';
				currentPath = null; // Reset current path on error
			}
		} finally {
			if (mounted) {
				loading = false;
			}
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
	{#if loading}
		<div class="loading">Loading PDF...</div>
	{:else if error}
		<div class="error">{error}</div>
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
		color: red;
	}
</style>
