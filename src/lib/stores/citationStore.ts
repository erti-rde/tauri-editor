import { writable, get } from 'svelte/store';
import { readSetting } from '$lib/settings';
import { BaseDirectory, readTextFile } from '@tauri-apps/plugin-fs';
import { projectSources } from '$lib/stores/db';
import { CitationEngine } from '$lib/citations/engine';
import { renderDocumentCitations, type CitationSite } from '$lib/citations/document';
import {
	fallbackLabel,
	parseManifest,
	resolveCitationSetup,
	type BundledManifest
} from '$lib/citations/bundled';

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
	/**
	 * Why citations can't be formatted, when they can't. The editor shows it
	 * instead of refusing to open (M0-3). Null when all is well.
	 */
	error: string | null;
}

export const citationStore = createCitationStore();

function createCitationStore() {
	// Initialize the store with empty state
	const { subscribe, set, update } = writable<CitationState>({
		engine: null,
		citationSources: {},
		bibliography: [],
		missingIds: [],
		error: null
	});

	/**
	 * Load the sources and build the citation engine.
	 *
	 * Never throws. A missing or broken style used to reject here, and the editor
	 * awaited this before building itself, so nothing could be written at all.
	 * Now a failure is recorded in `error`, the sources stay loaded so citations
	 * still get readable author-year labels, and the caller carries on. Returns
	 * whether the engine is ready.
	 */
	async function initializeCitationStore(): Promise<boolean> {
		const state = await getInitialState();
		set(state);
		if (state.error) console.error('Citations cannot be formatted:', state.error);
		return state.engine !== null;
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

		const known = ids.filter((id) => citationSources[id]);
		if (known.length === 0) return '';
		if (!engine) return fallbackLabel(known.map((id) => citationSources[id]));

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

/** The styles and locales that ship with the app, read once. */
let manifest: Promise<BundledManifest> | null = null;

const readResource = (path: string) =>
	readTextFile(`resources/csl/${path}`, { baseDir: BaseDirectory.Resource });

function bundledManifest(): Promise<BundledManifest> {
	manifest ??= readResource('bundled.json').then((text) => parseManifest(JSON.parse(text)));
	// A failed read must not be cached: the next attempt should try again.
	manifest.catch(() => (manifest = null));
	return manifest;
}

async function getInitialState(): Promise<CitationState> {
	const empty = { bibliography: [], missingIds: [] };

	// Sources first, and independently of the style: if the style can't load,
	// citations can still be labelled from the sources' own metadata.
	let citationSources: Record<string, CitationItem> = {};
	try {
		citationSources = await loadCitationSources();
	} catch (error) {
		return { ...empty, engine: null, citationSources, error: messageOf(error) };
	}

	// Each failure carries its own remedy: a damaged install needs reinstalling,
	// while a style citeproc rejects needs a different style.
	let setup;
	try {
		setup = await resolveCitationSetup(
			{
				styleXml: await readSetting('cslXml'),
				localeXml: await readSetting('localeXml'),
				selectedStyle: await readSetting('selectedStyle'),
				selectedLocale: await readSetting('selectedLocale')
			},
			bundledManifest,
			readResource
		);
	} catch (error) {
		return { ...empty, engine: null, citationSources, error: messageOf(error) };
	}

	try {
		return {
			...empty,
			engine: new CitationEngine({
				styleXml: setup.styleXml,
				localeXml: setup.localeXml,
				sources: citationSources
			}),
			citationSources,
			error: null
		};
	} catch (error) {
		const style = setup.styleName ? `"${setup.styleName}"` : 'The chosen style';
		return {
			...empty,
			engine: null,
			citationSources,
			error: `${style} could not be used (${messageOf(error)}). Choose another style in Settings.`
		};
	}
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function loadCitationSources(): Promise<Record<string, CitationItem>> {
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

	return citationSources;
}
