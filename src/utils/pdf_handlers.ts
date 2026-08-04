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
import { resolveMetadata, type ResolvedVia } from '$lib/ingest/resolve';
import { findDoi } from '$lib/ingest/identifiers';
import { getMailto, networkAllowed } from '$lib/stores/consent';

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

		if (pdfMetadata) {
			await setSourceMetadata({
				sha256,
				cslJson: JSON.stringify(pdfMetadata.metadata),
				zoteroType: (pdfMetadata.metadata.zotero_type as string) ?? null,
				doi: pdfMetadata.doi,
				resolvedVia: pdfMetadata.via
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
 * Resolve a source's citation metadata.
 *
 * Order matters: metadata salvaged from the previous library, then the paper's
 * own identifier found offline, then — only if the user has allowed it — a
 * lookup. Returns undefined when nothing resolved, which is recorded against the
 * source rather than stored as empty metadata.
 */
async function getPdfMetadata(
	pdfDoc: PDFDocumentProxy,
	sha256: string,
	fileName: string
): Promise<{ metadata: CitationItem; via: ResolvedVia; doi: string | null } | undefined> {
	try {
		// Work the previous library already did, reused rather than re-fetched.
		const salvaged = await legacyMetadataFor(fileName);
		if (salvaged) {
			const carried = JSON.parse(salvaged) as CitationItem;
			carried.id = sha256;
			await markLegacyConsumed(fileName);
			return { metadata: await withZoteroType(carried), via: 'legacy', doi: carried.DOI ?? null };
		}

		const info = (await pdfDoc.getMetadata()).info as PdfDocumentInfo | undefined;

		// Identifiers are printed in the page-one header or footer, or in the
		// margin, and sometimes repeated at the end.
		const pages = await extractPages(pdfDoc);
		const edges = [pages[0], pages[pages.length - 1]].filter(Boolean);

		const resolved = await resolveMetadata({
			info,
			text: pagesToText(edges),
			allowNetwork: await networkAllowed(),
			mailto: await getMailto()
		});
		if (!resolved) return undefined;

		const metadata = resolved.csl as CitationItem;
		metadata.id = sha256;

		// A non-string title breaks citeproc downstream.
		if (typeof metadata.title !== 'string') {
			metadata.title = Array.isArray(metadata.title)
				? ((metadata.title as unknown[])[0]?.toString() ?? fileName)
				: fileName;
		}

		// The reference list is large and never read back.
		if (metadata.reference) delete metadata.reference;

		return { metadata: await withZoteroType(metadata), via: resolved.via, doi: resolved.doi };
	} catch (error) {
		// Resolution failing must not stop the text from being indexed; the source
		// is simply left unresolved, visible and retryable.
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`Failed to get metadata for ${fileName}: ${errorMessage}`);
		return undefined;
	}
}

/** Attach the Zotero item type the metadata editor's form is driven by. */
async function withZoteroType(metadata: CitationItem): Promise<CitationItem> {
	if (!cslToZoteroTypeMap) {
		const augmentedSchema: AugmentedZoteroSchema = await augmentSchema();
		cslToZoteroTypeMap = augmentedSchema.cslToZoteroTypeMap;
	}
	metadata.zotero_type = cslToZoteroTypeMap.get(metadata.type) || '';
	return metadata;
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

/**
 * Re-attempt a source that previously failed or never resolved.
 *
 * The whole point of recording failures rather than swallowing them is that they
 * can be acted on. This re-runs the same path a first scan takes, so a transient
 * network problem or a since-granted consent is all it takes to succeed.
 */
export async function retryIngest(source: {
	sha256: string;
	path: string;
	file_name: string;
}): Promise<void> {
	await processSinglePdf(source.path, source.file_name, source.sha256);
}

/**
 * Resolve a source from a DOI the user supplies.
 *
 * Automatic resolution will never be perfect — a scanned chapter or a working
 * paper may carry no identifier at all. Pasting a DOI turns that from a silent
 * dead end into a few seconds' work.
 */
export async function applyManualDoi(sha256: string, doi: string): Promise<CitationItem> {
	const cleaned = findDoi(doi) ?? doi.trim();

	const resolved = await resolveMetadata({
		text: cleaned,
		allowNetwork: await networkAllowed(),
		mailto: await getMailto()
	});

	if (!resolved) {
		throw new Error(
			(await networkAllowed())
				? `Could not resolve ${cleaned}. Check the DOI, or enter the details by hand.`
				: 'Online lookups are turned off. Enable them in Settings, or enter the details by hand.'
		);
	}

	const metadata = resolved.csl as CitationItem;
	metadata.id = sha256;
	if (typeof metadata.title !== 'string') {
		metadata.title = Array.isArray(metadata.title)
			? ((metadata.title as unknown[])[0]?.toString() ?? cleaned)
			: cleaned;
	}
	if (metadata.reference) delete metadata.reference;

	const withType = await withZoteroType(metadata);
	await setSourceMetadata({
		sha256,
		cslJson: JSON.stringify(withType),
		zoteroType: (withType.zotero_type as string) ?? null,
		doi: resolved.doi ?? cleaned,
		resolvedVia: 'manual'
	});

	return withType;
}
