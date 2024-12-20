import { invoke } from '@tauri-apps/api/core';
import { join as pathJoin } from '@tauri-apps/api/path';
import { chunk } from 'llm-chunk';

import { get } from 'svelte/store';
import { dbStore } from '$lib/stores/db';
import { fileSystemStore } from '$lib/stores/fileSystem';

interface EmbeddingResult {
	chunk_text: string;
	embedding: number[];
}

async function executeQuery(query: string, params?: any[]) {
	const dbState = get(dbStore);
	if (dbState.db) {
		try {
			const result = await dbState.db.execute(query, params);

			return result;
		} catch (error) {
			console.error('Query failed:', error);
			throw error;
		}
	}
	throw new Error('Database not initialized');
}

async function selectQuery(query: string, params?: any[]) {
	const dbState = get(dbStore);
	if (dbState.db) {
		try {
			const result = await dbState.db.select(query, params);

			return result;
		} catch (error) {
			console.error('Query failed:', error);
			throw error;
		}
	}
	throw new Error('Database not initialized');
}

export async function extractAndChunkPdfs() {
	await executeQuery('delete from chunks;');
	await executeQuery('delete from documents;');
	// for testing we will do one file only
	// TODO: we will need a function that will check the whole dir and run rust function to extract it
	const fileSystem = get(fileSystemStore);
	const currentDir = fileSystem.currentPath;
	const file_name = 'yeoh-2001-postcolonial-cities.pdf';
	// Check if document already exists
	const existingDoc = await selectQuery('SELECT id FROM documents WHERE file_name = ?', [
		file_name
	]);
	console.log({ existingDoc });
	let documentId: number;

	if (existingDoc.length > 0) {
		documentId = existingDoc[0].id;
	} else {
		// Insert new document
		await executeQuery('INSERT INTO documents (file_name) VALUES (?)', [file_name]);
		// Get the last inserted ID
		const lastInsertResult = await selectQuery('SELECT last_insert_rowid() as id');
		console.log({ lastInsertResult });
		documentId = lastInsertResult[0].id as number;
		const pdfFilePath = await pathJoin(currentDir, file_name);
		const pdfOutput = (await invoke('extract_pdf', {
			pdfPath: pdfFilePath
		})) as string;
		const chunks = chunk(pdfOutput, { minLength: 100, splitter: 'sentence' });
		const embeddingResults = (await invoke('embed_chunks', {
			chunks
		})) as EmbeddingResult[];

		// Use a transaction for batch insert
		await executeQuery('BEGIN TRANSACTION');

		try {
			for (const result of embeddingResults) {
				await executeQuery(
					`INSERT INTO chunks (document_id, chunk_text, embedding)
                     VALUES (?, ?, ?)`,
					[documentId, result.chunk_text, JSON.stringify(result.embedding)]
				);
			}

			await executeQuery('COMMIT');
		} catch (error) {
			await executeQuery('ROLLBACK');
			throw error;
		}
	}
	await searchSimilarChunks('');
}

export async function searchSimilarChunks(query: string, topK: number = 5) {
	query = 'colonial development and postmodernism are related to each other';
	try {
		// Get query embedding
		const queryEmbeddingResult = (await invoke('embed_chunks', {
			chunks: [query]
		})) as EmbeddingResult[];

		const queryEmbedding = queryEmbeddingResult[0].embedding;

		// Get all chunks and their embeddings from database
		const chunks = await selectQuery('SELECT chunk_text, embedding FROM chunks');
		console.log({ chunks });
		// Calculate similarities
		const similarities = chunks.map((chunk: any) => {
			const chunkEmbedding = JSON.parse(chunk.embedding);
			const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);
			return {
				text: chunk.chunk_text,
				similarity
			};
		});

		// Sort by similarity in descending order and take top K
		const topResults = similarities.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
		console.log({ topResults });
		return topResults;
	} catch (error) {
		console.error('Error in similarity search:', error);
		throw error;
	}
}

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) {
		throw new Error('Vectors must have same length');
	}

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	normA = Math.sqrt(normA);
	normB = Math.sqrt(normB);

	if (normA === 0 || normB === 0) {
		return 0;
	}

	return dotProduct / (normA * normB);
}
