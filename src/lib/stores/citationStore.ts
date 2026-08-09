import { writable, get } from 'svelte/store';
import type { Store } from '@tauri-apps/plugin-store';
import { load as loadStore } from '@tauri-apps/plugin-store';
import { projectSources } from '$lib/stores/db';
import { CitationEngine } from '$lib/citations/engine';
import { renderDocumentCitations, type CitationSite } from '$lib/citations/document';

// Define types for our citation data
export interface CitationItem {
	id: string;
	type: string;
	title?: string;
	author?: Array<{
		family: string;
		given: string;
		// CSL-JSON's field for a name that does not split — an organisation, or a
		// consortium. Crossref returns these for institutional authors, and code
		// that only reads family/given renders them as an empty string.
		literal?: string;
		sequence?: string;
		affiliation?: Array<{ name: string }>;
	}>;
	issued?: {
		'date-parts': number[][];
	};
	DOI?: string;
	URL?: string;
	// CSL-JSON specifies a plain string here, and that is what doi.org returns.
	// citeproc silently drops the journal name when given an array, and
	// makeBibliography() throws outright for some styles (e.g. IEEE).
	'container-title'?: string;
	page?: string;
	volume?: string;
	issue?: string;
	publisher?: string;
	zotero_type?: string;
	[key: string]: string | number | boolean | object | Array<unknown> | undefined; // Allow for other CSL-JSON properties
}

interface CitationState {
	engine: CitationEngine | null;
	citationSources: Record<string, CitationItem>; // Store citation items by their ID
	/** Entries for the works cited by the most recent document render. */
	bibliography: string[];
	/** Cited ids with no source behind them, from the most recent render. */
	missingIds: string[];
}

export const citationStore = createCitationStore();

function createCitationStore() {
	// Initialize the store with empty state
	const { subscribe, set, update } = writable<CitationState>({
		engine: null,
		citationSources: {},
		bibliography: [],
		missingIds: []
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

	/**
	 * A citation rendered on its own, for previewing a source before it is cited.
	 *
	 * Deliberately not what the document uses. Disambiguation, short forms and
	 * note numbers are properties of the whole manuscript, so a citation formatted
	 * in isolation can only ever be an approximation — two different Smith 2020
	 * papers both preview as "(Smith, 2020)". Inserting one runs a full document
	 * render, which is what makes it correct.
	 */
	function previewCitation(ids: string[]): string {
		const { engine, citationSources } = get(citationStore);
		if (!engine) return '';

		const known = ids.filter((id) => citationSources[id]);
		if (known.length === 0) return '';

		try {
			return engine.render([{ id: 'preview', itemIds: known }])[0]?.text ?? '';
		} catch (error) {
			console.error('Could not preview citation:', error);
			return '';
		}
	}

	/**
	 * Render every citation in the document, and the bibliography that follows
	 * from it.
	 *
	 * This is the only correct way to format citations: citeproc needs the whole
	 * ordered list to disambiguate, to shorten back-references and to number
	 * notes. The result is published to the store so a bibliography component
	 * re-renders with it.
	 */
	function renderDocument(sites: CitationSite[]) {
		const { engine, citationSources } = get(citationStore);
		if (!engine) return null;

		try {
			const rendered = renderDocumentCitations(
				sites,
				engine,
				new Set(Object.keys(citationSources))
			);

			update((state) => ({
				...state,
				bibliography: rendered.bibliography,
				missingIds: rendered.missingIds
			}));

			return rendered;
		} catch (error) {
			// A style the processor rejects must not take the manuscript with it.
			console.error('Could not render the document citations:', error);
			return null;
		}
	}

	return {
		subscribe,
		initializeCitationStore,
		previewCitation,
		renderDocument,
		getAllSourcesAsJson,
		set
	};
}

async function getInitialState() {
	try {
		const store: Store = await loadStore('settings-store.json');

		const styleXml = (await store.get('cslXml')) as string;
		const localeXml = (await store.get('localeXml')) as string;

		if (!styleXml || !localeXml) {
			throw new Error(
				'No citation style is configured. Choose one in Settings before citing sources.'
			);
		}

		// Sources are keyed by content hash and scoped to the open project, with
		// any project-local metadata corrections already applied by the backend.
		const sources = await projectSources();

		const citationSources: Record<string, CitationItem> = {};

		for (const source of sources) {
			// Only sources that actually resolved can be cited. Including pending or
			// failed ones offered the user a source citeproc has nothing to format.
			if (source.state !== 'ready' || !source.csl_json) continue;

			citationSources[source.sha256] = {
				...JSON.parse(source.csl_json),
				id: source.sha256,
				file_name: source.file_name
			};
		}

		return {
			engine: new CitationEngine({ styleXml, localeXml, sources: citationSources }),
			citationSources,
			bibliography: [],
			missingIds: []
		};
	} catch (error) {
		console.error('Error in getInitialState:', error);
		throw error;
	}
}
