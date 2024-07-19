import { successToast, infoToast, errorToast } from '$utils/toasts';

import type { Citation } from '$types/citation';

export type responseDetails = {
	page: number;
	sentence: string;
	similarity: number;
	metadata: Citation;
};

export async function getMetadata(fileName: string) {
	try {
		const res = await fetch(`http://localhost:8135/get-metadata?file_name=${fileName}`);
		const metadata = await res.json();
		return metadata;
	} catch (e) {
		errorToast(`Error fetching metadata ${e}`);
	}
}

export async function createMetadata(filePath: string, fileName: string) {
	try {
		const res = await fetch(
			`http://localhost:8135/create-metadata?pdf_path=${filePath}&file_name=${fileName}`,
			{
				method: 'POST'
			}
		);
		const data = await res.json();
		return data;
	} catch (e) {
		errorToast(`Error creating metadata ${e}`);
	}
}

export async function updateMetadata(fileName: string, metadata: responseDetails['metadata']) {
	try {
		const res = await fetch('http://localhost:8135/update-metadata', {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				file_name: fileName,
				metadata
			})
		});
		const data = await res.json();
		return data;
	} catch (e) {
		errorToast(`Error updating metadata ${e}`);
	}
}

export async function deleteMetadata(filename: string) {
	try {
		const res = await fetch(`http://localhost:8135/delete-source?file_name=${filename}`, {
			method: 'DELETE'
		});
		const data = await res.json();
		return data;
	} catch (e) {
		errorToast(`Error deleting metadata ${e}`);
	}
}

export async function findSimilarSentences(query: string) {
	let response: responseDetails[] = [];
	try {
		// const appLocalDataDirPath = await appLocalDataDir();
		const fetchSentenceQuery = await fetch(
			`http://localhost:8135/find-similar-sentences?q=${query}`
		);
		const res = await fetchSentenceQuery.json();
		const result = (res as { similar_sentences: responseDetails[] }).similar_sentences;
		response = result;
	} catch (e) {
		errorToast('Error fetching similar sentences');
	}
	return response;
}

export async function tokeniseSource(sourcePath: string, fileName: string) {
	try {
		infoToast(`File ${fileName} is being processed`);
		const res = await fetch(
			`http://localhost:8135/tokenise-pdf?pdf_path=${sourcePath}&name=${fileName}`
		);

		const data = await res.json();
		if (data.status === 'completed') {
			successToast(`File ${fileName} processed successfully`);
		}
		return data;
	} catch (e) {
		errorToast(`Error tokenising file ${e}`);
	}
}
