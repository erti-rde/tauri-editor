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
	/**
	 * What appears at this point in the text.
	 *
	 * For an in-text style that is the citation itself, "(Smith, 2020)". For a
	 * note style it is the note's number, because the citation belongs in the
	 * note, not in the sentence.
	 */
	label: string;
	/** The note's text, for note styles. Empty for in-text styles. */
	note: string;
	/** 1-based for note styles, 0 for in-text styles. */
	noteIndex: number;
	/** Ids cited here that no longer exist in the library. */
	missingIds: string[];
}

export interface RenderedNote {
	/** The number printed against the note, and against its marker in the text. */
	index: number;
	/** The note's text, as HTML. */
	text: string;
}

export interface DocumentCitations {
	sites: RenderedSite[];
	/** Notes in document order. Empty unless the style is a note style. */
	notes: RenderedNote[];
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
	const noteStyle = engine.isNoteStyle;
	const notes: RenderedNote[] = [];

	const renderedSites: RenderedSite[] = perSite.map((entry) => {
		const hit = rendered.get(entry.clusterId);

		if (!hit) {
			return {
				pos: entry.site.pos,
				label: MISSING_SOURCE_LABEL,
				note: '',
				noteIndex: 0,
				missingIds: entry.missingIds
			};
		}

		// In a note style citeproc returns the note's *text*. Putting that inline
		// drops a full bibliographic reference into the middle of the sentence,
		// which is what Chicago and Turabian exist to avoid: the sentence carries
		// a marker, and the reference goes below.
		if (noteStyle) {
			notes.push({ index: hit.noteIndex, text: hit.text });
			return {
				pos: entry.site.pos,
				label: String(hit.noteIndex),
				note: hit.text,
				noteIndex: hit.noteIndex,
				missingIds: entry.missingIds
			};
		}

		return {
			pos: entry.site.pos,
			label: hit.text,
			note: '',
			noteIndex: hit.noteIndex,
			missingIds: entry.missingIds
		};
	});

	return {
		sites: renderedSites,
		notes,
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
		if (typeof parsed === 'string') return [parsed];

		// An all-digit id parses as a number, and `1e5` does too. Treating that as
		// "no ids" renders the citation as a removed source. An object, on the
		// other hand, was never a legacy id.
		return parsed !== null && typeof parsed === 'object' ? [] : [attr];
	} catch {
		// An older document stored a bare id rather than an array.
		return [attr];
	}
}
