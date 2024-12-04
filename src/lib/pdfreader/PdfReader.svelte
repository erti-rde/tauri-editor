<script lang="ts">
	import { onMount } from 'svelte';
	import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
	import * as pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs';
	import { invoke } from '@tauri-apps/api/core';
	import { currentFileStore } from '$lib/stores/openFileStore';

	import Controls from './Controls.svelte';

	import type { RenderTask, PDFDocumentProxy } from 'pdfjs-dist';
	import type { PdfAction } from './Controls.svelte';

	let canvasElement: HTMLCanvasElement;
	let canvasContainer: HTMLDivElement;
	let loading = false;
	let error: string | null = null;
	let currentRenderTask: RenderTask | null = null;
	let mounted = false;
	let currentPath: string | null = null; // Track current PDF path
	let pdf: PDFDocumentProxy;
	let pdfPage = 1;
	let pdfPageCount = 0;
	let zoom = 1;

	// Define zoom step and limits
	const ZOOM_STEP = 0.25;
	const MIN_ZOOM = 0.25;
	const MAX_ZOOM = 3;

	const PdfActionMap: Record<PdfAction, (...args: any[]) => void> = {
		'next-page': () => {
			if (pdfPageCount > pdfPage) {
				pdfPage++;
				renderPage();
			}
		},
		'previous-page': () => {
			if (pdfPage > 1) {
				pdfPage--;
				renderPage();
			}
		},
		'zoom-in': () => {
			if (zoom < MAX_ZOOM) {
				zoom += ZOOM_STEP;
				renderPage();
			}
		},
		'zoom-out': () => {
			if (zoom > MIN_ZOOM) {
				zoom -= ZOOM_STEP;
				renderPage();
			}
		}
	};

	onMount(() => {
		mounted = true;
		pdfjsLib.GlobalWorkerOptions.workerSrc = import.meta.url + 'pdfjs-dist/build/pdf.worker.mjs';

		return () => {
			mounted = false;
			if (currentRenderTask) {
				currentRenderTask.cancel();
			}
		};
	});
	async function renderPage() {
		// Fetch the first page
		const canvas = canvasElement;
		if (!mounted || !canvas) {
			return;
		}
		pdf.getPage(pdfPage).then(function (page) {
			const viewport = page.getViewport({ scale: zoom });

			// Prepare canvas using PDF page dimensions
			const context = canvas.getContext('2d');
			canvas.height = viewport.height;
			canvas.width = viewport.width;

			// Render PDF page into canvas context
			const renderContext = {
				canvasContext: context,
				viewport: viewport
			};

			const renderTask = page.render(renderContext);
			renderTask.promise;
		});
	}
	async function renderPdf(pdfPath: string) {
		// Prevent re-rendering the same PDF
		if (currentPath === pdfPath || !mounted || !canvasElement) {
			return;
		}

		if (currentRenderTask) {
			currentRenderTask.cancel();
			currentRenderTask = null;
		}

		loading = true;
		error = null;
		currentPath = pdfPath;

		try {
			// Get base64 encoded PDF data from Tauri backend
			invoke('read_pdf_file', { path: pdfPath }).then((res) => {
				const base64Data = res;
				var pdfData = atob(base64Data as string);
				pdfjsLib.getDocument({ data: pdfData }).promise.then((data) => {
					pdf = data;
					pdfPageCount = data.numPages;
					renderPage();
				});
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
				currentRenderTask = null;
			}
		}
	}

	// More controlled reactive statement
	$: if (mounted && canvasElement && $currentFileStore && currentPath !== $currentFileStore) {
		renderPdf($currentFileStore);
	}
	function handlePdfControls(e: CustomEvent) {
		PdfActionMap[e.detail.action as PdfAction]();
	}
</script>

<div class="flex h-full w-full flex-col items-center" bind:this={canvasContainer}>
	<Controls on:pdfAction={handlePdfControls} />

	{#if loading}
		<div class="loading">Loading PDF...</div>
	{:else if error}
		<div class="error">{error}</div>
	{:else}
		<div class="overflow-auto">
			<canvas bind:this={canvasElement} />
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
