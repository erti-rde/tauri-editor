import { invoke } from '@tauri-apps/api/core';
import { chunk } from 'llm-chunk';
import { get } from 'svelte/store';

import { selectQuery, executeQuery } from './db';
import { fileSystemStore } from '$lib/stores/fileSystem';
import { setStatus } from '$lib/statusFooter/StatusFooter.svelte';
import { errorToast, successToast } from '$lib/toast/Toast.svelte';

import type { FileItem } from '$lib/stores/fileSystem';

export interface EmbeddingResult {
	chunk_text: string;
	embedding: number[];
}

async function processSinglePdf(filePath: string, fileName: string): Promise<void> {
	try {
		// Check if document exists within the transaction
		const existingDoc = await selectQuery('SELECT id FROM documents WHERE file_name = ?', [
			fileName
		]);

		const documentId = existingDoc[0].id as string;

		const pdfOutput = (await invoke('extract_pdf', { pdfPath: filePath })) as string;
		const chunks = chunk(pdfOutput, { minLength: 100, splitter: 'sentence' });
		const embeddingResults = (await invoke('embed_chunks', { chunks })) as EmbeddingResult[];

		// Prepare all chunk insertions
		for (const result of embeddingResults) {
			await executeQuery(
				`INSERT INTO chunks (document_id, chunk_text, embedding)
                 VALUES (?, ?, ?)`,
				[documentId, result.chunk_text, JSON.stringify(result.embedding)]
			);
		}

		successToast(`${fileName} processed successfully`);
	} catch (error) {
		await executeQuery('ROLLBACK');
		errorToast(`Failed to process ${fileName}: ${error.message}`);
		throw error;
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
	console.log({ pdfs });
	return pdfs;
}

async function getExistingDocuments(): Promise<Set<string>> {
	const existingDocs = await selectQuery('SELECT file_name FROM documents');
	return new Set(existingDocs.map((doc) => doc.file_name));
}

async function createDocumentBatch(pdfFiles: FileItem[]) {
	try {
		await executeQuery('BEGIN TRANSACTION');

		for (const fileName of pdfFiles) {
			const result = await executeQuery('INSERT INTO documents (file_name) VALUES (?)', [
				fileName.name
			]);
			console.log({ result });
		}

		await executeQuery('COMMIT');
	} catch (error) {
		await executeQuery('ROLLBACK');
		throw error;
	}
}

export async function extractAndChunkPdfs() {
	// await executeQuery('delete from chunks;');
	// await executeQuery('delete from documents;');
	const fileSystem = get(fileSystemStore);

	try {
		// Get all PDF files recursively (you'll need to implement this Rust function)
		const pdfFiles = findPdfFiles(fileSystem.items);

		// Get existing documents from database
		const existingDocs = await getExistingDocuments();
		// Filter out already processed PDFs
		const newPdfs = pdfFiles.filter((file) => !existingDocs.has(file.name));

		if (newPdfs.length === 0) {
			return;
		}

		setStatus({
			side: 'left',
			message: `Found ${pdfFiles.length} PDF files (${newPdfs.length} new to process, ${pdfFiles.length - newPdfs.length} already processed)`,
			type: 'info'
		});

		await createDocumentBatch(pdfFiles);
		let processed = 0;

		// Process PDFs concurrently in batches to avoid overwhelming the system
		const batchSize = 3;
		// Process PDFs concurrently in batches
		for (let i = 0; i < newPdfs.length; i += batchSize) {
			const batch = newPdfs.slice(i, i + batchSize);
			await Promise.all(
				batch.map(async (file) => {
					try {
						await processSinglePdf(file.path, file.name);
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
