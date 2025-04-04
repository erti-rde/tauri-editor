import { writable, get } from 'svelte/store';
import CSL from 'citeproc';
import type { Store } from '@tauri-apps/plugin-store';
import { load as loadStore } from '@tauri-apps/plugin-store';
import { selectQuery } from '$utils/db';

// Define types for our citation data
export interface CitationItem {
	id: string | number;
	type: string;
	title?: string;
	author?: Array<{
		family: string;
		given: string;
		sequence?: string;
		affiliation?: Array<{ name: string }>;
	}>;
	issued?: {
		'date-parts': number[][];
	};
	DOI?: string;
	URL?: string;
	'container-title'?: string[];
	page?: string;
	volume?: string;
	issue?: string;
	publisher?: string;
	zotero_type?: string;
	[key: string]: string | number | boolean | object | Array<unknown> | undefined; // Allow for other CSL-JSON properties
}

interface CitationState {
	engine: CSL.Engine | null;
	citationSources: Record<string, CitationItem>; // Store citation items by their ID
}
export const citationStore = createCitationStore();

function createCitationStore() {
	// Initialize the store with empty state
	const { subscribe, set } = writable<CitationState>({
		engine: null,
		citationSources: {}
	});

	async function initializeCitationStore() {
		try {
			const state = await getInitialState();
			set(state);
		} catch (error) {
			console.error('Failed to initialize citation store:', error);
			throw error;
		}
	}

	function getAllSourcesAsJson() {
		return get(citationStore).citationSources;
	}

	function getInlineCitation(ids: string[]) {
		let inlineCitation = '';
		const state = get(citationStore);

		if (!state.engine) {
			console.error('CSL Engine not initialized');
			return `[Citation engine not ready]`;
		}

		// Verify all IDs exist
		const missingIds = ids.filter((id) => !state.citationSources[id]);
		if (missingIds.length > 0) {
			console.error(`Some citation sources not found: ${missingIds.join(', ')}`);
			return `[Citations not found: ${missingIds.join(', ')}]`;
		}

		try {
			// Create a proper citation object
			const citation = {
				citationItems: ids.map((id) => ({ id })),
				properties: {
					noteIndex: 0
				}
			};
			// Process the citation with careful error handling
			const result = state.engine.processCitationCluster(citation, [], []);

			if (
				result &&
				Array.isArray(result) &&
				result[1] &&
				Array.isArray(result[1]) &&
				result[1].length > 0
			) {
				inlineCitation = result[1][0][1];
				if (!inlineCitation || typeof inlineCitation !== 'string') {
					console.error('Invalid citation result format:', result);
					inlineCitation = `[Invalid citation format]`;
				}
			} else {
				console.error('Invalid result from processCitationCluster:', result);
				inlineCitation = `[Processing error]`;
			}
		} catch (error) {
			console.error('Error processing citation:', error);
		}

		return inlineCitation;
	}

	// Generate bibliography
	function generateBibliography() {
		let bibliography = '';
		const state = get(citationStore);

		if (state.engine) {
			const bib = state.engine.makeBibliography();
			if (bib !== false) {
				bibliography = bib[1].join('\n');
			}
		}
		return bibliography;
	}

	return {
		subscribe,
		initializeCitationStore,
		getInlineCitation,
		getAllSourcesAsJson,
		generateBibliography
	};
}

async function getInitialState() {
	try {
		const store: Store = await loadStore('settings-store.json');

		const styleXml = (await store.get('cslXml')) as string;
		const localeXml = (await store.get('localeXml')) as string;

		console.log('CSL Engine Initialization:');
		console.log('Style XML exists:', !!styleXml);
		console.log('Locale XML exists:', !!localeXml);

		// Log the first 100 chars to check content format
		console.log('Style XML snippet:', styleXml?.substring(0, 300));
		console.log('Locale XML snippet:', localeXml?.substring(0, 300));

		const itemsJson2 = (await selectQuery(`
		  SELECT
				 files.id, files.file_name, sm.metadata
			FROM
			 files
			LEFT JOIN
			  source_metadata sm ON files.id = sm.file_id
		`)) as {
			id: number;
			file_name: string;
			metadata: string;
		}[];

		const citationSources: Record<string, CitationItem> = {};

		itemsJson2.forEach((item) => {
			citationSources[item.id] = { file_name: item.file_name, ...JSON.parse(item.metadata) };
		});

		console.log('Citation sources loaded:', Object.keys(citationSources).length);

		const createCslSystem = () => ({
			retrieveLocale: () => {
				console.log('Retrieving locale...');
				return localeXml;
			},
			retrieveItem: (id: string) => {
				console.log('Retrieving item:', id);
				console.log('Item exists:', !!citationSources[id]);
				return citationSources[id];
			}
		});

		const sys = createCslSystem();

		// Create engine with try/catch to catch any initialization errors
		let engine;
		try {
			engine = new CSL.Engine(sys, styleXml);
			console.log('CSL Engine created successfully');
		} catch (error) {
			console.error('Error creating CSL Engine:', error);
			throw error;
		}

		return {
			engine,
			citationSources
		};
	} catch (error) {
		console.error('Error in getInitialState:', error);
		throw error;
	}
}
