import CSL from 'citeproc';

import type { CitationItem } from '$lib/stores/citationStore';

/**
 * A single citation point in a document, in document order.
 *
 * citeproc-js cannot format a citation correctly in isolation: disambiguation
 * (`2020a` / `2020b`), back-references (`Ibid.`, short forms) and note numbering
 * all depend on what else is cited and where. The engine therefore takes the
 * whole ordered list rather than one cluster at a time.
 */
export interface CitationCluster {
	/** Stable identifier for this cluster within the document. */
	id: string;
	/** Source ids cited at this point, in the order they should be rendered. */
	itemIds: string[];
}

export interface RenderedCitation {
	clusterId: string;
	/** 1-based note number for note styles, 0 for in-text styles. */
	noteIndex: number;
	/** Formatted citation, as HTML. */
	text: string;
}

export interface CitationEngineOptions {
	/** CSL style XML. */
	styleXml: string;
	/** CSL locale XML. */
	localeXml: string;
	/** Every source available to cite, keyed by id. */
	sources: Record<string, CitationItem>;
}

/**
 * True when the style renders citations as footnotes/endnotes rather than
 * in-text. Note styles need real, ascending note indices; in-text styles expect 0.
 */
function isNoteStyle(styleXml: string): boolean {
	return /class\s*=\s*"note"/.test(styleXml);
}

export class CitationEngine {
	private engine: CSL.Engine;
	private readonly noteStyle: boolean;

	constructor({ styleXml, localeXml, sources }: CitationEngineOptions) {
		this.noteStyle = isNoteStyle(styleXml);

		const sys = {
			retrieveLocale: () => localeXml,
			retrieveItem: (id: string) => sources[id]
		};

		this.engine = new CSL.Engine(sys, styleXml);
	}

	/**
	 * Render every citation in the document.
	 *
	 * Replaces the processor's entire citation state, so the result reflects the
	 * document as a whole. Call this whenever citations are added, removed or
	 * reordered — incremental updates are what make disambiguation go stale.
	 */
	render(clusters: CitationCluster[]): RenderedCitation[] {
		const citations = clusters.map((cluster, i) => ({
			citationID: cluster.id,
			citationItems: cluster.itemIds.map((id) => ({ id })),
			properties: {
				// Note styles number their notes from 1; in-text styles use 0 throughout.
				noteIndex: this.noteStyle ? i + 1 : 0
			}
		}));

		// Register the cited set so makeBibliography() reflects exactly these works.
		this.engine.updateItems(clusters.flatMap((c) => c.itemIds));

		const rebuilt = this.engine.rebuildProcessorState(citations) as unknown as [
			string,
			number,
			string
		][];

		return rebuilt.map(([clusterId, noteIndex, text]) => ({ clusterId, noteIndex, text }));
	}

	/**
	 * Bibliography entries for the works cited by the most recent `render()`,
	 * in the order the style prescribes. Empty when the style suppresses one.
	 */
	bibliography(): string[] {
		const bib = this.engine.makeBibliography();
		return bib === false ? [] : bib[1];
	}
}
