import { invoke } from '@tauri-apps/api/core';
import { chunk } from 'llm-chunk';
import { get } from 'svelte/store';

import { dbStore } from '$lib/stores/db'; 
import { fileSystemStore } from '$lib/stores/fileSystem';
import { removeStatus, setStatus } from '$lib/statusFooter/StatusFooter.svelte';
import { errorToast, successToast } from '$lib/toast/Toast.svelte';
import { readFile } from '@tauri-apps/plugin-fs';
import { augmentSchema } from '$lib/metadata-explorer/adapterCslZotero';

import type { AugmentedZoteroSchema } from '$lib/metadata-explorer/adapterCslZotero';
import type { FileItem } from '$lib/stores/fileSystem';

import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import type { CitationItem } from '$lib/stores/citationStore';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs-2/build/pdf.worker.min.mjs';

const { executeQuery } = dbStore;
let cslToZoteroTypeMap: Map<string, string> | undefined;

export interface EmbeddingResult {
	chunk_text: string;
	embedding: number[];
}

/**
 * Process a single PDF file by extracting text, retrieving metadata,
 * chunking the text, and storing in the database
 * @param filePath Path to the PDF file
 * @param fileName Name of the PDF file
 * @param fileId Database ID for the file
 */
async function processSinglePdf(filePath: string, fileName: string, fileId: number) {
	let pdfDoc: PDFDocumentProxy | undefined;
	try {
		const pdfBytes = await readFile(filePath);
		pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;

		const pdfOutput = await extractTextFromPDf(pdfDoc);
		const pdfMetadata = await getPdfMetadata(pdfDoc, fileId, fileName);

		const chunks = chunk(pdfOutput, { minLength: 100, splitter: 'sentence' });
		const embeddingResults = (await invoke('embed_chunks', { chunks })) as EmbeddingResult[];

		// Prepare all insertions
		const insertPromises = embeddingResults.map((result) =>
			executeQuery(`INSERT INTO chunks (file_id, chunk_text, embedding) VALUES (?, ?, ?)`, [
				fileId,
				result.chunk_text,
				JSON.stringify(result.embedding)
			])
		);
		
		if (pdfMetadata) {
			insertPromises.push(
				executeQuery(`INSERT INTO source_metadata (file_id, metadata) VALUES (?, ?)`, [
					fileId,
					JSON.stringify(pdfMetadata)
				])
			);
		}

		// Execute all insertions in parallel
		await Promise.all(insertPromises);

		successToast(`${fileName} processed successfully`);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		errorToast(`Failed to process ${fileName}: ${errorMessage}`);
		throw error;
	} finally {
		// Ensure PDF document is properly closed to prevent memory leaks
		try {
			pdfDoc?.destroy();
		} catch (e) {
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
async function getPdfMetadata(pdfDoc: PDFDocumentProxy, fileId: number, fileName: string) {
	try {
		let metadata: CitationItem | undefined = undefined;
		const { info } = await pdfDoc.getMetadata();
		
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
			const firstPageText = content.items.map((item) => item.str).join(' ');
			
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
			metadata.id = fileId.toString();
			
			if (!cslToZoteroTypeMap) {
				const augmentedSchema: AugmentedZoteroSchema = await augmentSchema();
				cslToZoteroTypeMap = augmentedSchema.cslToZoteroTypeMap;
			}
			
			metadata.zotero_type = cslToZoteroTypeMap.get(metadata.type) || '';
		}

		// Handle potential non-string title formats
		if (metadata && typeof metadata.title !== 'string') {
			if (Array.isArray(metadata.title)) {
				metadata.title = metadata.title[0]?.toString() || fileName;
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
		// Log error but allow processing to continue with empty metadata
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`Failed to get metadata for ${fileName}: ${errorMessage}`);
		return {};
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
 * Retrieve existing processed files from the database
 */
async function getExistingFiles(): Promise<Array<{ id: number; file_name: string }>> {
	return (await executeQuery(`
    SELECT
   	  files.id, file_name
    FROM
  		files
		`)) as Array<{ id: number; file_name: string }>;
}

/**
 * Create database entries for a batch of PDF files
 * @param pdfFiles List of PDF files to create entries for
 * @returns List of files with their database IDs
 */
async function createFileBatch(pdfFiles: FileItem[]): Promise<Array<FileItem & { id: number }>> {
	const insertedFiles = [];

	for (const file of pdfFiles) {
		const result = await executeQuery('INSERT INTO files (file_name) VALUES (?)', [file.name]);
		insertedFiles.push({ ...file, id: result.lastInsertId });
	}

	return insertedFiles;
}

/**
 * Extract text content from a PDF document
 * @param pdf PDF document to extract text from
 * @returns Concatenated text content from all pages
 */
async function extractTextFromPDf(pdf: PDFDocumentProxy): Promise<string> {
	try {
		const totalPageCount = pdf.numPages;
		// Extract text from each page
		const pageTextPromises = Array.from({ length: totalPageCount }, async (_, i) => {
			const pageNum = i + 1;
			const page = await pdf.getPage(pageNum);
			const textContent = await page.getTextContent();

			// Release page resources after extraction
			page.cleanup();
			
			return textContent.items.map((item) => item.str).join('');
		});

		const content = await Promise.all(pageTextPromises);
		return content.join(' ');
	} catch (error) {
		await executeQuery('ROLLBACK');
		throw error;
	}
}

/**
 * Main function to extract text from PDFs, chunk it, and store in the database
 */
export async function extractAndChunkPdfs(): Promise<void> {
	const fileSystem = get(fileSystemStore);
	try {
		// Get all PDF files recursively
		const pdfFiles = findPdfFiles(fileSystem.items);

		// Get existing files from database
		const existingFiles = await getExistingFiles();

		// Filter out already processed PDFs
		const existingFileNames = new Set(existingFiles.map((file) => file.file_name));
		let newPdfs = pdfFiles.filter((file) => !existingFileNames.has(file.name));

		if (newPdfs.length === 0) {
			return;
		}

		setStatus({
			side: 'left',
			message: `Found ${pdfFiles.length} PDF files (${newPdfs.length} new to process, ${pdfFiles.length - newPdfs.length} already processed)`,
			type: 'info'
		});

		newPdfs = await createFileBatch(newPdfs);

		let processed = 0;

		// Process PDFs concurrently in batches to avoid overwhelming the system
		const batchSize = 3;
		for (let i = 0; i < newPdfs.length; i += batchSize) {
			const batch = newPdfs.slice(i, i + batchSize);
			await Promise.all(
				batch.map(async (file) => {
					try {
						await processSinglePdf(file.path, file.name, file.id as number);
						processed++;
						setStatus({
							side: 'left',
							message: `Processing PDFs: ${processed}/${newPdfs.length}`,
							type: 'info'
						});
					} catch (error) {
						// Continue processing other files even if one fails
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
