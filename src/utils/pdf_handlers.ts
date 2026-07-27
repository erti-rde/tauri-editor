import { invoke } from '@tauri-apps/api/core';
import { chunk } from 'llm-chunk';
import { get } from 'svelte/store';

import {
	hashFile,
	markIngestFailed,
	registerSource,
	setSourceMetadata,
	storeChunks
} from '$lib/stores/db';
import { fileSystemStore } from '$lib/stores/fileSystem.svelte';
import { removeStatus, setStatus } from '$lib/statusFooter/StatusFooter.svelte';
import { errorToast, successToast } from '$lib/toast/Toast.svelte';
import { readFile } from '@tauri-apps/plugin-fs';
import { augmentSchema } from '$lib/metadata-explorer/adapterCslZotero';

import type { AugmentedZoteroSchema } from '$lib/metadata-explorer/adapterCslZotero';
import type { FileItem } from '$lib/stores/fileSystem.svelte';

import * as pdfjsLib from 'pdfjs-dist';
// Resolve the worker from the same package as the library above, so the two can
// never drift apart. This previously pointed at a hand-copied worker in
// static/pdfjs-2/, which pdf.js rejects outright when the versions disagree.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
	PDFDocumentProxy,
	TextItem,
	TextMarkedContent
} from 'pdfjs-dist/types/src/display/api';
import type { CitationItem } from '$lib/stores/citationStore';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** The subset of pdf.js document info we read. pdf.js types this as bare `Object`. */
interface PdfDocumentInfo {
	Author?: string;
	Title?: string;
	author?: string;
	title?: string;
}

/**
 * A page's text content is a mix of positioned text runs and marked-content
 * markers; only the former carry a `str`.
 */
function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
	return 'str' in item;
}
let cslToZoteroTypeMap: Map<string, string> | undefined;

export interface EmbeddingResult {
	chunk_text: string;
	embedding: number[];
}

/**
 * Extract, embed and store one PDF, keyed by the hash of its contents.
 *
 * Chunks and ingest status are written together in Rust, so a source is only
 * ever 'ready' if it genuinely succeeded. A failure is recorded rather than
 * swallowed, which is what makes it visible and retryable — the old pipeline
 * registered the file up front and deduplicated on the filename, so anything
 * that failed once was skipped forever.
 */
async function processSinglePdf(filePath: string, fileName: string, sha256: string) {
	let pdfDoc: PDFDocumentProxy | undefined;
	try {
		const pdfBytes = await readFile(filePath);
		pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;

		const pdfOutput = await extractTextFromPDf(pdfDoc);
		const pdfMetadata = await getPdfMetadata(pdfDoc, sha256, fileName);

		const chunks = chunk(pdfOutput, { minLength: 100, splitter: 'sentence' });
		const embeddingResults = (await invoke('embed_chunks', { chunks })) as EmbeddingResult[];

		await storeChunks(
			sha256,
			embeddingResults.map((result) => ({
				text: result.chunk_text,
				embedding: result.embedding
			}))
		);

		if (pdfMetadata && Object.keys(pdfMetadata).length > 0) {
			await setSourceMetadata({
				sha256,
				cslJson: JSON.stringify(pdfMetadata),
				zoteroType: (pdfMetadata.zotero_type as string) ?? null,
				doi: (pdfMetadata.DOI as string) ?? null,
				resolvedVia: 'crossref'
			});
		}

		successToast(`${fileName} processed successfully`);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		await markIngestFailed(sha256, errorMessage);
		errorToast(`Failed to process ${fileName}: ${errorMessage}`);
		throw error;
	} finally {
		// Ensure PDF document is properly closed to prevent memory leaks
		try {
			pdfDoc?.destroy();
		} catch {
			// Silently handle destroy errors
		}
	}
}

/**
 * Extract metadata from a PDF document and attempt to find DOI information
 * @param pdfDoc PDF document to extract metadata from
 * @param fileId Database ID for the file
 * @param fileName Name of the PDF file for error reporting
 */
async function getPdfMetadata(pdfDoc: PDFDocumentProxy, sha256: string, fileName: string) {
	try {
		let metadata: CitationItem | undefined = undefined;
		const info = (await pdfDoc.getMetadata()).info as PdfDocumentInfo | undefined;

		let query = 'https://api.crossref.org/works?rows=1&sort=score&select=DOI';

		// Build query based on available metadata
		if (info?.Author && info?.Title) {
			// If we have author and title, we can make a more accurate search query
			query += `&query.author=${encodeURIComponent(info.Author)}&query.title=${encodeURIComponent(info.Title)}`;
		} else if (info?.author && info?.title) {
			// Handle lowercase keys
			query += `&query.author=${encodeURIComponent(info.author)}&query.title=${encodeURIComponent(info.title)}`;
		} else {
			// Fallback to text extraction from the first page
			const firstPage = await pdfDoc.getPage(1);
			const content = await firstPage.getTextContent();
			const firstPageText = content.items
				.filter(isTextItem)
				.map((item) => item.str)
				.join(' ');

			// Limit query length to avoid excessively long URLs
			query += `&query=${encodeURIComponent(firstPageText.substring(0, 1000))}`;

			// Clean up page resources
			firstPage.cleanup();
		}

		// Retrieve DOI information
		const res = await fetch(query);
		const data = await res.json();

		if (data.status === 'ok' && data.message?.items?.length > 0) {
			const itemID = data.message.items[0].DOI;
			const getCitationWithDoi = await fetch(`https://doi.org/${itemID}`, {
				headers: {
					Accept: 'application/vnd.citationstyles.csl+json'
				}
			});

			metadata = (await getCitationWithDoi.json()) as CitationItem;
			metadata.id = sha256;

			if (!cslToZoteroTypeMap) {
				const augmentedSchema: AugmentedZoteroSchema = await augmentSchema();
				cslToZoteroTypeMap = augmentedSchema.cslToZoteroTypeMap;
			}

			metadata.zotero_type = cslToZoteroTypeMap.get(metadata.type) || '';
		}

		// Handle potential non-string title formats
		if (metadata && typeof metadata.title !== 'string') {
			if (Array.isArray(metadata.title)) {
				metadata.title = (metadata.title as unknown[])[0]?.toString() || fileName;
			} else {
				metadata.title = fileName;
			}
		}

		// Remove reference field to reduce storage size
		if (metadata?.reference) {
			delete metadata.reference;
		}

		return metadata;
	} catch (error) {
		// Allow ingest to continue, but return undefined rather than {}. Storing an
		// empty object is what left 52% of the old database with literal '{}'
		// metadata that looked resolved and never got retried.
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`Failed to get metadata for ${fileName}: ${errorMessage}`);
		return undefined;
	}
}

/**
 * Recursively find PDF files in the file system
 * @param items List of file items to search
 * @returns Array of PDF files found
 */
function findPdfFiles(items: FileItem[]): FileItem[] {
	let pdfs: FileItem[] = [];
	for (const item of items) {
		if (!item.is_dir && item.name.toLowerCase().endsWith('.pdf')) {
			pdfs.push(item);
		}
		if (item.children) {
			pdfs = pdfs.concat(findPdfFiles(item.children));
		}
	}
	return pdfs;
}

/**
 * Extract text content from a PDF document
 * @param pdf PDF document to extract text from
 * @returns Concatenated text content from all pages
 */
async function extractTextFromPDf(pdf: PDFDocumentProxy): Promise<string> {
	// Failures propagate to processSinglePdf, which records them against the
	// source. This used to wrap everything in a try/catch solely to issue a
	// ROLLBACK, though no transaction was ever open; storage now happens later,
	// in one Rust transaction per source.
	const totalPageCount = pdf.numPages;

	// Extract text from each page
	const pageTextPromises = Array.from({ length: totalPageCount }, async (_, i) => {
		const pageNum = i + 1;
		const page = await pdf.getPage(pageNum);
		const textContent = await page.getTextContent();

		// Release page resources after extraction
		page.cleanup();

		return textContent.items
			.filter(isTextItem)
			.map((item) => item.str)
			.join('');
	});

	const content = await Promise.all(pageTextPromises);
	return content.join(' ');
}

/**
 * Main function to extract text from PDFs, chunk it, and store in the database
 */
export async function extractAndChunkPdfs(): Promise<void> {
	const fileSystem = get(fileSystemStore);
	try {
		// Get all PDF files recursively
		const pdfFiles = findPdfFiles(fileSystem.items);
		if (pdfFiles.length === 0) {
			return;
		}

		setStatus({ side: 'left', message: `Found ${pdfFiles.length} PDF files`, type: 'info' });

		// Identify every PDF by the hash of its contents and register it against
		// the project. Registration reports whether the hash was new to the
		// library: a paper already read for another project keeps its chunks and
		// is simply added to this one, with no re-embedding. Deduplicating on the
		// filename, as before, both missed this and silently dropped same-named
		// files in different folders.
		const needsIngest: Array<FileItem & { sha256: string }> = [];
		for (const file of pdfFiles) {
			try {
				const sha256 = await hashFile(file.path);
				if (await registerSource(sha256, file.path, file.name)) {
					needsIngest.push({ ...file, sha256 });
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`Could not register ${file.name}:`, message);
			}
		}

		if (needsIngest.length === 0) {
			setStatus({
				side: 'left',
				message: `All ${pdfFiles.length} PDFs are already in your library`,
				type: 'info'
			});
			setTimeout(() => removeStatus(), 3000);
			return;
		}

		setStatus({
			side: 'left',
			message: `Processing ${needsIngest.length} new PDFs (${pdfFiles.length - needsIngest.length} already in your library)`,
			type: 'info'
		});

		let processed = 0;

		// Process PDFs concurrently in batches to avoid overwhelming the system
		const batchSize = 3;
		for (let i = 0; i < needsIngest.length; i += batchSize) {
			const batch = needsIngest.slice(i, i + batchSize);
			await Promise.all(
				batch.map(async (file) => {
					try {
						await processSinglePdf(file.path, file.name, file.sha256);
						processed++;
						setStatus({
							side: 'left',
							message: `Processing PDFs: ${processed}/${needsIngest.length}`,
							type: 'info'
						});
					} catch (error) {
						// Continue with the rest. The failure is recorded against the
						// source, so it stays visible and can be retried rather than
						// being skipped forever.
						const errorMessage = error instanceof Error ? error.message : String(error);
						console.error(`Error processing ${file.name}:`, errorMessage);
					}
				})
			);
		}

		setStatus({
			side: 'left',
			message: `Completed processing ${processed} PDF files`,
			type: 'info'
		});

		setTimeout(() => {
			removeStatus();
		}, 3000);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		setStatus({
			side: 'left',
			message: `Error processing PDFs: ${errorMessage}`,
			type: 'error'
		});
		console.error('Error processing PDFs:', error);
	}
}
