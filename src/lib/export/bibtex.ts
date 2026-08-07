import type { CitationItem } from '$lib/stores/citationStore';

/**
 * The cited sources as a `.bib`.
 *
 * The `.tex` refers to sources by key and this supplies them, so the journal's
 * own class file formats the references rather than receiving strings Erti
 * already formatted.
 *
 * Keys are the interesting part. A source's identity here is the SHA-256 of its
 * PDF, which is not a legal BibTeX key and would be unreadable if it were —
 * `\cite{a8046cb7…}` tells a co-author editing the `.tex` nothing. They are
 * built the way researchers write them by hand instead: `smith2020coastal`.
 */

export interface BibEntry {
	key: string;
	type: string;
	fields: Record<string, string>;
}

/** CSL types that have a natural BibTeX equivalent. */
const TYPES: Record<string, string> = {
	'article-journal': 'article',
	'article-magazine': 'article',
	'article-newspaper': 'article',
	article: 'article',
	book: 'book',
	chapter: 'incollection',
	'paper-conference': 'inproceedings',
	thesis: 'phdthesis',
	report: 'techreport',
	manuscript: 'unpublished',
	webpage: 'misc',
	dataset: 'misc'
};

/** Only what BibTeX will not choke on, and what reads well in a `\cite`. */
function slug(value: string): string {
	return (
		value
			.normalize('NFD')
			// Strip diacritics rather than dropping the letters: "Müller" becomes
			// "muller", not "mller".
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '')
	);
}

function firstAuthor(item: CitationItem): string {
	const author = item.author?.[0];
	if (!author) return '';
	return slug(author.family ?? author.given ?? '');
}

function year(item: CitationItem): string {
	const parts = item.issued?.['date-parts']?.[0];
	return parts?.[0] ? String(parts[0]) : '';
}

function firstTitleWord(item: CitationItem): string {
	if (typeof item.title !== 'string') return '';

	// Leading articles carry no information and make every key start the same.
	const words = item.title
		.split(/\s+/)
		.map(slug)
		.filter((w) => w.length > 2 && !['the', 'and', 'for', 'with'].includes(w));

	return words[0] ?? '';
}

/**
 * A readable, stable key.
 *
 * Stable matters more than pretty: the key appears in the `.tex`, so a key that
 * changed between exports would silently break every `\cite` in a manuscript a
 * co-author was already editing.
 */
export function citationKey(item: CitationItem, taken: ReadonlySet<string> = new Set()): string {
	const base = `${firstAuthor(item)}${year(item)}${firstTitleWord(item)}`;
	// A source with no author, year or title still needs a key, and the hash is
	// the only thing guaranteed to exist.
	const candidate = base.length > 0 ? base : `source${slug(String(item.id ?? '')).slice(0, 8)}`;

	if (!taken.has(candidate)) return candidate;

	// Two papers by the same author, year and title word: `smith2020coastal`,
	// then `smith2020coastalb`, matching how a person disambiguates by hand.
	for (let i = 1; i < 26; i++) {
		const suffixed = `${candidate}${String.fromCharCode(97 + i)}`;
		if (!taken.has(suffixed)) return suffixed;
	}

	return `${candidate}${taken.size}`;
}

/**
 * Escape a field value.
 *
 * BibTeX reads `{`, `}` and `\` structurally, and a stray `&` or `%` breaks the
 * compile the same way it does in the `.tex`.
 */
const FIELD_ESCAPES: Record<string, string> = {
	'\\': '\\textbackslash{}',
	'{': '\\{',
	'}': '\\}',
	'&': '\\&',
	'%': '\\%',
	$: '\\$',
	'#': '\\#',
	_: '\\_',
	'~': '\\textasciitilde{}',
	'^': '\\textasciicircum{}'
};

export function escapeBibtex(value: string): string {
	return value.replace(/[\\{}&%$#_~^]/g, (character) => FIELD_ESCAPES[character] ?? character);
}

function authorsOf(item: CitationItem): string {
	if (!item.author?.length) return '';

	// BibTeX joins with " and ", and takes "Family, Given" so a multi-word family
	// name is not mistaken for a middle name.
	return item.author
		.map((a) => (a.family && a.given ? `${a.family}, ${a.given}` : (a.family ?? a.given ?? '')))
		.filter(Boolean)
		.join(' and ');
}

/** One CSL item as a BibTeX entry. */
export function toBibEntry(item: CitationItem, key: string): BibEntry {
	const fields: Record<string, string> = {};

	const put = (name: string, value: unknown) => {
		if (typeof value === 'string' && value.trim().length > 0) fields[name] = value.trim();
	};

	put('author', authorsOf(item));
	put('title', item.title);
	put('journal', item['container-title']);
	put('year', year(item));
	put('volume', item.volume);
	put('number', item.issue);
	put('pages', typeof item.page === 'string' ? item.page.replace(/-+/g, '--') : undefined);
	put('publisher', item.publisher);
	put('doi', item.DOI);
	put('url', item.URL);

	const type = TYPES[String(item.type ?? '')] ?? 'misc';

	// BibTeX requires a publisher for a book and a journal for an article; a
	// missing one is a warning rather than a failure, so the entry is emitted
	// with what exists rather than dropped.
	return { key, type, fields };
}

/**
 * Fields BibTeX must not re-case.
 *
 * `plain` and most journal styles lowercase a title unless it is brace
 * protected, so "Coastal Erosion under Rising Sea Levels" is printed as
 * "Coastal erosion under rising sea levels" — and proper nouns go with it:
 * "DNA" becomes "dna", "Bayesian" becomes "bayesian". Researchers brace titles
 * by hand for exactly this reason.
 */
const CASE_SENSITIVE = new Set(['title', 'journal', 'publisher']);

export function formatBibEntry(entry: BibEntry): string {
	const body = Object.entries(entry.fields)
		.map(([name, value]) => {
			const escaped = escapeBibtex(value);
			return `  ${name} = {${CASE_SENSITIVE.has(name) ? `{${escaped}}` : escaped}}`;
		})
		.join(',\n');

	return `@${entry.type}{${entry.key},\n${body}\n}`;
}

export interface BibliographyExport {
	/** The `.bib` file's contents. */
	bibtex: string;
	/** sha256 → citation key, for the `.tex` to cite by. */
	keys: Record<string, string>;
}

/**
 * Build a `.bib` for the sources a manuscript cites.
 *
 * Only the cited ones: a `.bib` of the whole library would list papers the
 * manuscript never mentions, and some journals check.
 */
export function toBibliography(
	sources: Record<string, CitationItem>,
	citedIds: readonly string[]
): BibliographyExport {
	const taken = new Set<string>();
	const keys: Record<string, string> = {};
	const entries: string[] = [];

	// Deduplicated and in a stable order, so re-exporting an unchanged manuscript
	// produces an identical file rather than a spurious diff.
	for (const id of [...new Set(citedIds)].sort()) {
		const item = sources[id];
		if (!item) continue;

		const key = citationKey(item, taken);
		taken.add(key);
		keys[id] = key;
		entries.push(formatBibEntry(toBibEntry(item, key)));
	}

	return { bibtex: entries.join('\n\n') + (entries.length ? '\n' : ''), keys };
}
