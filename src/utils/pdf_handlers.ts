import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';

import {
	hashFile,
	legacyMetadataFor,
	markIngestFailed,
	markLegacyConsumed,
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
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import type { CitationItem } from '$lib/stores/citationStore';
// Extraction and chunking live in $lib/ingest so the retrieval benchmark runs
// exactly this code rather than a copy that can drift.
import { extractPages, pagesToText } from '$lib/ingest/extract';
import { chunkPages } from '$lib/ingest/chunk';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** The subset of pdf.js document info we read. pdf.js types this as bare `Object`. */
interface PdfDocumentInfo {
	Author?: string;
	Title?: string;
	author?: string;
	title?: string;
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

		const pages = await extractPages(pdfDoc);
		const pdfMetadata = await getPdfMetadata(pdfDoc, sha256, fileName);

		const chunks = chunkPages(pages);
		const embeddingResults = (await invoke('embed_chunks', {
			chunks: chunks.map((c) => c.text)
		})) as EmbeddingResult[];

		// Page, section and offsets travel with the chunk, so a result can say
		// "p. 4, Results" and later jump to the passage in the PDF (#37).
		await storeChunks(
			sha256,
			embeddingResults.map((result, i) => ({
				text: result.chunk_text,
				embedding: result.embedding,
				page_start: chunks[i]?.pageStart ?? null,
				page_end: chunks[i]?.pageEnd ?? null,
				section: chunks[i]?.section ?? null,
				char_start: chunks[i]?.charStart ?? null,
				char_end: chunks[i]?.charEnd ?? null
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
		// Metadata that already resolved under the previous library is reused
		// rather than re-fetched, which also avoids telling Crossref about a paper
		// twice.
		const salvaged = await legacyMetadataFor(fileName);
		if (salvaged) {
			const carried = JSON.parse(salvaged) as CitationItem;
			carried.id = sha256;
			await markLegacyConsumed(fileName);
			return carried;
		}

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
			// Use the same extractor as ingest: the old inline version joined runs
			// with a space and produced text riddled with broken words.
			const firstPageText = pagesToText(
				await extractPages({ numPages: 1, getPage: (n) => pdfDoc.getPage(n) })
			);

			// Limit query length to avoid excessively long URLs
			query += `&query=${encodeURIComponent(firstPageText.substring(0, 1000))}`;
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
