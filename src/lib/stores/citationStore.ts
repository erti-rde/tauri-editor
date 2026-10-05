import { writable, get } from 'svelte/store';
import { readSetting } from '$lib/settings';
import { BaseDirectory, readTextFile } from '@tauri-apps/plugin-fs';
import { projectSources, sourceAliases } from '$lib/stores/db';
import { CitationEngine } from '$lib/citations/engine';
import {
	locatorsByWork,
	renderDocumentCitations,
	type CitationSite
} from '$lib/citations/document';
import { canonical, canonicalIds, type Aliases } from '$lib/citations/aliases';
import {
	fallbackLabel,
	parseManifest,
	resolveCitationSetup,
	type BundledManifest
} from '$lib/citations/bundled';
import { log } from '$lib/log';

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
	/**
	 * The library's aliases (ADR 003). `citationSources` is keyed by canonical
	 * id only, so every id from a manuscript, a search or a note goes through
	 * `canonicalId` before it's looked up there.
	 */
	aliases: Aliases;
	/** Entries for the works cited by the most recent document render. */
	bibliography: string[];
	/** Cited ids with no source behind them, from the most recent render. */
	missingIds: string[];
	/**
	 * Why citations can't be formatted, when they can't. The editor shows it
	 * instead of refusing to open (M0-3). Null when all is well.
	 */
	error: string | null;
	/**
	 * Cited sources this library doesn't have, rendered from the snapshot the
	 * manuscript carries (M1a-8, UX-12). The library's copy wins when both exist.
	 */
	awayIds: string[];
}

export const citationStore = createCitationStore();

function createCitationStore() {
	// Initialize the store with empty state
	const { subscribe, set, update } = writable<CitationState>({
		engine: null,
		citationSources: {},
		aliases: {},
		bibliography: [],
		missingIds: [],
		error: null,
		awayIds: []
	});

	/** The sources the open manuscript carries (ADR 002). */
	let carried: Record<string, object> = {};
	/** `awayIds` as a set: every citation asks on every render. */
	let away = new Set<string>();

	/**
	 * Put the manuscript's sources beside the library's, for ids the library
	 * lacks. Added to the same object the engine reads, so citeproc formats
	 * them like any other source.
	 */
	function mergeCarried() {
		update((state) => {
			const sources = state.citationSources;
			for (const id of state.awayIds ?? []) delete sources[id];
			// By work: a snapshot of a PDF's hash isn't away once the library has
			// the book it was attached to. One the library lacks is filed under
			// its work's id, which is where rendering looks.
			const awayIds: string[] = [];
			for (const [id, item] of Object.entries(carried)) {
				const work = canonical(state.aliases ?? {}, id);
				if (work in sources) continue;
				sources[work] = { ...item, id: work } as CitationItem;
				awayIds.push(work);
			}
			away = new Set(awayIds);
			return { ...state, awayIds };
		});
	}

	/** The open manuscript's carried sources; replaces the previous manuscript's. */
	function setManuscriptSources(sources: Record<string, object>) {
		carried = sources;
		mergeCarried();
	}

	function isAway(id: string): boolean {
		return away.has(canonicalId(id));
	}

	/** The id the work behind `id` is known by: the one to cite and look up. */
	function canonicalId(id: string): string {
		return canonical(get(citationStore).aliases ?? {}, id);
	}

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
		set({ ...state, awayIds: [] });
		mergeCarried();
		// As an error, so its words reach the log (quotes taken out): a bare
		// string is never written, and this one says why nothing can be cited.
		if (state.error) log.error('Citations cannot be formatted', new Error(state.error));
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
	 * render, which is what makes it correct. `locators` are the pages cited, by
	 * id (M1b-8).
	 */
	function previewCitation(ids: string[], locators: Record<string, string> = {}): string {
		const { engine, citationSources, aliases } = get(citationStore);

		const known = canonicalIds(aliases ?? {}, ids).filter((id) => citationSources[id]);
		if (known.length === 0) return '';
		if (!engine) return fallbackLabel(known.map((id) => citationSources[id]));

		// Each page goes with its work, whichever of the work's ids it was given by.
		const pages = locatorsByWork(locators, (id) => canonical(aliases ?? {}, id));

		try {
			return engine.render([{ id: 'preview', itemIds: known, locators: pages }])[0]?.text ?? '';
		} catch (error) {
			log.error('Could not preview citation', error);
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
		const { engine, citationSources, aliases } = get(citationStore);
		if (!engine) return null;

		try {
			const rendered = renderDocumentCitations(
				sites,
				engine,
				new Set(Object.keys(citationSources)),
				// The state read once above, not a store read per cited id.
				(id) => canonical(aliases ?? {}, id)
			);

			update((state) => ({
				...state,
				bibliography: rendered.bibliography,
				missingIds: rendered.missingIds
			}));

			return rendered;
		} catch (error) {
			// A style the processor rejects must not take the manuscript with it.
			log.error('Could not render the document citations', error);
			return null;
		}
	}

	return {
		subscribe,
		initializeCitationStore,
		previewCitation,
		renderDocument,
		getAllSourcesAsJson,
		canonicalId,
		setManuscriptSources,
		isAway,
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
	// Sources first, and independently of the style: if the style can't load,
	// citations can still be labelled from the sources' own metadata.
	let citationSources: Record<string, CitationItem> = {};
	let aliases: Aliases = {};
	try {
		[citationSources, aliases] = await Promise.all([
			loadCitationSources(),
			// Without the aliases only a citation of an attached PDF or a merged id
			// goes missing; without the sources, every citation does. So a failure
			// here costs the aliases alone.
			sourceAliases().catch((error: unknown) => {
				log.error('Could not load the library’s aliases', error);
				return {};
			})
		]);
	} catch (error) {
		const empty = { bibliography: [], missingIds: [], awayIds: [], aliases };
		return { ...empty, engine: null, citationSources, error: messageOf(error) };
	}
	const empty = { bibliography: [], missingIds: [], awayIds: [], aliases };

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
