import { writable, get } from 'svelte/store';
import CSL from 'citeproc';
import type { Store } from '@tauri-apps/plugin-store';
import { load as loadStore } from '@tauri-apps/plugin-store';
import { readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';

// Define types for our citation data
export interface CitationItem {
	id: string;
	type: string;
	title?: string[];
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
			const initialState = await getInitialState();
			set(initialState);
		} catch (error) {
			console.error('Failed to initialize citation store:', error);
			throw error;
		}
	}

	function getAllSourcesAsJson() {
		return get(citationStore).citationSources;
	}

	function getInlineCitation(id: string) {
		let inlineCitation = '';
		const state = get(citationStore);
		if (state.engine && state.citationSources[id]) {
			const citation = {
				citationItems: [{ id }],
				properties: {
					noteIndex: 0
				}
			};
			const result = state.engine.processCitationCluster(citation, [], []);
			console.log({ result });
			if (result && result[1] && result[1].length > 0) {
				inlineCitation = result[1][0][1];
			}
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
	const store: Store = await loadStore('settings-store.json');

	const styleXml = (await store.get('cslXml')) as string;
	const localeXml = (await store.get('localeXml')) as string;

	const itemsJson = await readTextFile('resources/csl/citationSources.json', {
		baseDir: BaseDirectory.Resource
	});
	const citationSources: Record<string, CitationItem> = JSON.parse(itemsJson);

	const createCslSystem = () => ({
		retrieveLocale: () => {
			// Return the locale XML - for now using the one you provided
			return localeXml;
		},
		retrieveItem: (id: string) => {
			return citationSources[id];
		}
	});

	const sys = createCslSystem();
	return {
		engine: new CSL.Engine(sys, styleXml),
		citationSources
	};
}
