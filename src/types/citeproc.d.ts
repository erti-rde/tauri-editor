declare module 'citeproc' {
	export class Engine {
		constructor(sys: CSLSystem, style: string, lang?: string, forceLang?: boolean);
		updateItems(idList: string[]): void;
		updateUncitedItems(idList: string[]): void;
		makeBibliography(keywordFilter?: BibliographyFilter): [BibliographyMeta, string[]] | false;
		appendCitationCluster(
			citationsPre: Citation[],
			citationNew: Citation,
			citationsPost: Citation[]
		): [number, number, string][];
		processCitationCluster(
			citation: Citation,
			citationsPre: Citation[],
			citationsPost: Citation[]
		): [Citations, Citations];
		previewCitationCluster(
			citation: Citation,
			citationsPre: Citation[],
			citationsPost: Citation[]
		): string;
		restoreProcessorState(citations: Citation[]): void;
		rebuildProcessorState(citations: Citation[], mode?: string): void;
		setOutputFormat(format: string): void;
	}
}
