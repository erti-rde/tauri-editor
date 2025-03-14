import { invoke } from '@tauri-apps/api/core';
import { chunk } from 'llm-chunk';
import { get } from 'svelte/store';

import { selectQuery, executeQuery } from './db';
import { fileSystemStore } from '$lib/stores/fileSystem';
import { setStatus } from '$lib/statusFooter/StatusFooter.svelte';
import { errorToast, successToast } from '$lib/toast/Toast.svelte';
import { readFile } from '@tauri-apps/plugin-fs';

import type { FileItem } from '$lib/stores/fileSystem';

import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import type { CitationItem } from '$lib/stores/citationStore';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs-2/build/pdf.worker.min.mjs';

export interface EmbeddingResult {
	chunk_text: string;
	embedding: number[];
}

async function processSinglePdf(filePath: string, fileName: string, fileId: number) {
	try {
		const pdfBytes = await readFile(filePath);
		const pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;

		const pdfOutput = await extractTextFromPDf(pdfDoc);
		const pdfMetadata = await getPdfMetadata(pdfDoc, fileId, fileName);
		console.log({ pdfMetadata });
		const chunks = chunk(pdfOutput, { minLength: 100, splitter: 'sentence' });
		const embeddingResults = (await invoke('embed_chunks', { chunks })) as EmbeddingResult[];

		// Prepare all chunk insertions
		// Create an array of promises for all insertions
		const insertPromises = embeddingResults.map((result) =>
			executeQuery(
				`INSERT INTO chunks (file_id, chunk_text, embedding)
																	VALUES (?, ?, ?)`,
				[fileId, result.chunk_text, JSON.stringify(result.embedding)]
			)
		);
		if (pdfMetadata) {
			insertPromises.push(
				executeQuery(
					`INSERT INTO source_metadata (file_id, zotero_type, metadata)
																	VALUES (?, ?, ?)`,
					[fileId, convertCslTypetoZoteroType(pdfMetadata.type), JSON.stringify(pdfMetadata)]
				)
			);
		}

		// Execute all insertions in parallel
		await Promise.all(insertPromises);

		successToast(`${fileName} processed successfully`);
	} catch (error) {
		errorToast(`Failed to process ${fileName}: ${error.message}`);
		throw error;
	}
}
function convertCslTypetoZoteroType(type: String) {
	// Convert types with hyphens or underscores to camelCase
	return type
		.split(/[-_]/)
		.map((word, index) => {
			if (index === 0) return word.toLowerCase();
			return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
		})
		.join('');
}
async function getPdfMetadata(pdfDoc: PDFDocumentProxy, fileId: number, fileName: string) {
	try {
		let metadata: CitationItem | undefined = undefined;
		const { info } = await pdfDoc.getMetadata();
		console.log({ info });
		let query = 'http://api.crossref.org/works?rows=1&sort=score&select=DOI';
		if (info?.Author && info?.Title) {
			// If we have author and title, we can make a more accurate search query
			query += `&query.author=${encodeURIComponent(info.Author)}&query.title=${encodeURIComponent(info.Title)}`;
		} else if (info?.author && info?.title) {
			// Handle lowercase keys
			query += `&query.author=${encodeURIComponent(info.author)}&query.title=${encodeURIComponent(info.title)}`;
		} else {
			const firstPage = await pdfDoc.getPage(1);
			console.log({ firstPage });
			const content = await firstPage.getTextContent();
			const firstPageText = content.items.map((item) => item.str).join(' ');

			query += `&query=${encodeURIComponent(firstPageText)}`;
		}

		// get doi
		const res = await fetch(query);
		const data = await res.json();
		if (data.status == 'ok') {
			console.log(data);
			const itemID = data.message.items[0].DOI;
			const getCitaitonWithDoi = await fetch(`https://doi.org/${itemID}`, {
				headers: {
					Accept: 'application/vnd.citationstyles.csl+json'
				}
			});
			metadata = (await getCitaitonWithDoi.json()) as CitationItem;
			metadata.id = fileId.toString();
		}

		if (metadata && typeof metadata?.title !== 'string') {
			// If title is an array, extract the first string value
			if (Array.isArray(metadata.title)) {
				metadata.title = metadata.title[0]?.toString();
			} else {
				metadata.title = JSON.stringify(metadata.title);
			}
		}

		if (metadata?.reference) {
			delete metadata.reference;
		}

		return metadata;
	} catch (error) {
		console.error(`Failed to get metadata for ${fileName}: ${error.message}`);
	}
}

// Helper function to recursively find PDF files
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

async function getExistingFiles() {
	return (await selectQuery(`
    SELECT
   	  files.id, file_name
    FROM
  		files
		`)) as {
		id: number;
		file_name: string;
	}[];
}

async function createFileBatch(pdfFiles: FileItem[]) {
	try {
		const insertedFiles = [];
		await executeQuery('BEGIN TRANSACTION');

		for (const file of pdfFiles) {
			const result = await executeQuery('INSERT INTO files (file_name) VALUES (?)', [file.name]);

			insertedFiles.push({ ...file, id: result.lastInsertId });
		}

		await executeQuery('COMMIT');
		return insertedFiles;
	} catch (error) {
		await executeQuery('ROLLBACK');
		throw error;
	}
}

async function extractTextFromPDf(pdf: PDFDocumentProxy) {
	try {
		const totalPageCount = pdf.numPages;
		// Extract text from each page
		const pageTextPromises = Array.from({ length: totalPageCount }, async (_, i) => {
			const pageNum = i + 1;
			const page = await pdf.getPage(pageNum);
			const textContent = await page.getTextContent();

			return textContent.items.map((item) => item.str).join('');
		});

		const content = await Promise.all(pageTextPromises);

		return content.join('');
	} catch (error) {
		await executeQuery('ROLLBACK');
		throw error;
	}
}

export async function extractAndChunkPdfs() {
	const fileSystem = get(fileSystemStore);
	try {
		// Get all PDF files recursively (you'll need to implement this Rust function)
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
		// Process PDFs concurrently in batches
		for (let i = 0; i < newPdfs.length; i += batchSize) {
			const batch = newPdfs.slice(i, i + batchSize);
			await Promise.all(
				batch.map(async (file) => {
					try {
						await processSinglePdf(file.path, file.name, file.id as number);
						processed++;
						setStatus({
							side: 'left',
							message: `Processing PDFs: ${processed}/${pdfFiles.length}`,
							type: 'info'
						});
					} catch (error) {
						console.error(`Error processing ${file.name}:`, error);
					}
				})
			);
		}

		setStatus({
			side: 'left',
			message: `Completed processing ${processed} PDF files`,
			type: 'success'
		});

		setTimeout(() => {
			setStatus({});
		}, 1500);
	} catch (error) {
		setStatus({
			side: 'left',
			message: `Error processing PDFs: ${error.message}`,
			type: 'error'
		});
		console.error('Error processing PDFs:', error);
	}
}
