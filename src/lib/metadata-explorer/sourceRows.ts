import type { CitationItem } from '$lib/stores/citationStore';

/**
 * How a source reads in the explorer list.
 *
 * Pure, and out of the component, because it is the part with decisions in it —
 * which name to show when there are four authors, what to call a
 * `paper-conference` — and a component that mounts the whole Zotero schema and
 * the database is not a place those decisions can be tested.
 */

/**
 * CSL type slugs are the vocabulary of the citation format, not of the person
 * reading the list. "article-journal" is a paper; "manuscript" is how CSL
 * spells preprint.
 */
const TYPE_NAMES: Record<string, string> = {
	'article-journal': 'Paper',
	'article-magazine': 'Magazine',
	'article-newspaper': 'News',
	'paper-conference': 'Conference',
	article: 'Article',
	book: 'Book',
	chapter: 'Chapter',
	thesis: 'Thesis',
	report: 'Report',
	manuscript: 'Preprint',
	webpage: 'Web page',
	dataset: 'Dataset',
	software: 'Software'
};

/** What kind of thing this is, in the words a researcher uses for it. */
export function describeType(metadata: CitationItem | null): string {
	const type = metadata?.type;
	if (!type) return '—';

	// The long tail stays readable rather than becoming "Unknown": a slug with
	// the hyphens taken out is still the right word most of the time.
	return TYPE_NAMES[type] ?? type.replace(/-/g, ' ');
}

/**
 * Who wrote it, in the space one column allows.
 *
 * Academic lists are read by first author, and "et al." is what the reader
 * already expects to see there — showing four names would push the title out
 * of the row that people actually scan by.
 */
export function describeAuthors(metadata: CitationItem | null): string | null {
	const authors = metadata?.author;
	if (!authors || authors.length === 0) return null;

	const first = authors[0];
	// An organisation is stored in `literal`, with no given/family to join.
	const name = first.literal ?? [first.family, first.given].filter(Boolean).join(', ');
	if (!name) return null;

	return authors.length > 1 ? `${name} et al.` : name;
}
