import { CitationEngine, type CitationCluster } from './engine';

/**
 * Rendering every citation in a document as one act.
 *
 * citeproc-js cannot format a citation correctly in isolation. Disambiguation
 * (`2020a` / `2020b`), back-references (`Ibid.`, short forms) and note numbering
 * are all properties of the document, not of the citation — two different Smith
 * 2020 papers can only be told apart by a processor that knows about both.
 *
 * The editor previously re-rendered each citation on its own, with an empty
 * surrounding context and a hardcoded `noteIndex: 0`. That silently produced
 * academically wrong output: no disambiguation, no short forms, and note styles
 * — Chicago notes-bibliography and Turabian, the humanities standard — unusable.
 *
 * So the unit of work here is the whole ordered list of citation sites.
 */

/** One citation node in the document, in document order. */
export interface CitationSite {
	/** Position of the node, used to write the rendered label back. */
	pos: number;
	/** Source ids cited at this point. */
	itemIds: string[];
}

export interface RenderedSite {
	pos: number;
	/** Formatted citation, as HTML. */
	label: string;
	/** 1-based for note styles, 0 for in-text styles. */
	noteIndex: number;
	/** Ids cited here that no longer exist in the library. */
	missingIds: string[];
}

export interface DocumentCitations {
	sites: RenderedSite[];
	bibliography: string[];
	/** Every cited id with no source behind it, deduplicated. */
	missingIds: string[];
}

/** Shown in place of a citation whose source has been deleted. */
export const MISSING_SOURCE_LABEL = '[source removed]';

/**
 * Render every citation site against the document as a whole.
 *
 * Sources can disappear — a source is removed from the project, or a manuscript
 * is opened against a different library. Handing citeproc an id it cannot
 * resolve throws deep inside the processor, which would blank every citation in
 * the document over one missing paper. Unresolvable ids are dropped from their
 * cluster instead, and reported so the editor can mark them.
 */
export function renderDocumentCitations(
	sites: readonly CitationSite[],
	engine: CitationEngine,
	knownIds: ReadonlySet<string>
): DocumentCitations {
	const missing = new Set<string>();

	const perSite = sites.map((site, i) => {
		const present = site.itemIds.filter((id) => knownIds.has(id));
		for (const id of site.itemIds) {
			if (!knownIds.has(id)) missing.add(id);
		}

		return {
			site,
			clusterId: `c${i}`,
			present,
			missingIds: site.itemIds.filter((id) => !knownIds.has(id))
		};
	});

	// A cluster with nothing left to cite is not given to citeproc at all: an
	// empty citationItems array makes the processor emit an empty citation and
	// still consume a note number, so the notes after it would be misnumbered.
	const clusters: CitationCluster[] = perSite
		.filter((entry) => entry.present.length > 0)
		.map((entry) => ({ id: entry.clusterId, itemIds: entry.present }));

	const rendered = new Map(clusters.length > 0 ? renderOrEmpty(engine, clusters) : []);

	return {
		sites: perSite.map((entry) => {
			const hit = rendered.get(entry.clusterId);

			return {
				pos: entry.site.pos,
				label: hit?.text ?? MISSING_SOURCE_LABEL,
				noteIndex: hit?.noteIndex ?? 0,
				missingIds: entry.missingIds
			};
		}),
		bibliography: clusters.length > 0 ? engine.bibliography() : [],
		missingIds: [...missing]
	};
}

function renderOrEmpty(engine: CitationEngine, clusters: CitationCluster[]) {
	return engine
		.render(clusters)
		.map((r) => [r.clusterId, { text: r.text, noteIndex: r.noteIndex }] as const);
}

/**
 * Read a citation node's `id` attribute.
 *
 * It holds a JSON-encoded array of source ids, because one citation point can
 * cite several works at once — `(Smith, 2020; Jones, 2019)`. Malformed or
 * legacy values yield no ids rather than throwing, so one bad node cannot stop
 * the document rendering.
 */
export function parseCitationIds(attr: unknown): string[] {
	if (typeof attr !== 'string' || attr.length === 0) return [];

	try {
		const parsed = JSON.parse(attr);
		if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string');
		return typeof parsed === 'string' ? [parsed] : [];
	} catch {
		// An older document stored a bare id rather than an array.
		return [attr];
	}
}
