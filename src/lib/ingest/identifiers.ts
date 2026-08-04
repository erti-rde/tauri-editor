/**
 * Finding a paper's own identifier in its text.
 *
 * The old pipeline asked Crossref to guess the paper from its embedded title and
 * author, which in real academic PDFs are routinely empty or junk
 * (`"Microsoft Word - final_v3.doc"`), and fell back to throwing a thousand
 * characters of page-one text at a search endpoint. It resolved 9% of a real
 * corpus.
 *
 * Most published papers state their own DOI on the first page, and arXiv papers
 * carry their identifier in the margin. Looking there first is both far more
 * reliable and completely offline — no network call, and nothing disclosed about
 * what is being read.
 *
 * Like the rest of `$lib/ingest`, this file avoids Tauri and Svelte imports so
 * it can be exercised directly.
 */

/**
 * A DOI as it appears in running text.
 *
 * Deliberately not anchored: DOIs turn up mid-sentence, after "https://doi.org/",
 * and inside citation blocks.
 */
const DOI_PATTERN = /\b(10\.\d{4,9}\/[-._;()/:a-z0-9]+)/gi;

/** arXiv's post-2007 scheme, and the older archive/number form. */
const ARXIV_PATTERNS = [
	/\barxiv\s*:\s*(\d{4}\.\d{4,5})(v\d+)?\b/i,
	/\barxiv\.org\/abs\/(\d{4}\.\d{4,5})(v\d+)?\b/i,
	/\barxiv\s*:\s*([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?\b/i
];

/**
 * Trailing punctuation that belongs to the sentence, not the DOI.
 *
 * DOIs may legitimately end in almost anything, so only characters that would be
 * unbalanced are trimmed — a closing parenthesis is kept when the DOI opened one.
 */
function trimTrailingPunctuation(doi: string): string {
	let result = doi;

	for (;;) {
		const last = result[result.length - 1];
		if (last === undefined) break;

		if ('.,;:'.includes(last)) {
			result = result.slice(0, -1);
			continue;
		}
		if (last === ')' && hasExcessClosingParen(result)) {
			result = result.slice(0, -1);
			continue;
		}
		break;
	}

	return result;
}

/**
 * True when the string closes more parentheses than it opens, meaning the final
 * `)` belongs to the surrounding sentence rather than to the DOI.
 */
function hasExcessClosingParen(text: string): boolean {
	let open = 0;
	let close = 0;
	for (const ch of text) {
		if (ch === '(') open++;
		else if (ch === ')') close++;
	}
	return close > open;
}

/**
 * The first DOI in a piece of text, normalised to lowercase.
 *
 * Returns null rather than guessing. A wrong DOI is worse than none: it produces
 * confidently incorrect metadata that a user has no reason to double-check.
 */
export function findDoi(text: string): string | null {
	DOI_PATTERN.lastIndex = 0;

	for (const match of text.matchAll(DOI_PATTERN)) {
		const doi = trimTrailingPunctuation(match[1]);
		// A bare "10.1000/" prefix with nothing after it is not a DOI.
		if (doi.length > 8 && doi.includes('/') && !doi.endsWith('/')) {
			return doi.toLowerCase();
		}
	}

	return null;
}

/** The arXiv identifier in a piece of text, without any version suffix. */
export function findArxivId(text: string): string | null {
	for (const pattern of ARXIV_PATTERNS) {
		const match = text.match(pattern);
		if (match) return match[1];
	}
	return null;
}

export interface IdentifierHit {
	kind: 'doi' | 'arxiv';
	value: string;
	/** Where it was found, for the audit trail stored on the source. */
	source: 'metadata' | 'text';
}

/**
 * Look for an identifier in a document's embedded metadata, then its text.
 *
 * `text` should be the first and last pages: the DOI is usually printed in the
 * header or footer of page one, and otherwise in the reference block at the end.
 */
export function findIdentifier(
	info: { doi?: unknown } | undefined,
	text: string
): IdentifierHit | null {
	// Some producers write the DOI into the PDF's own metadata dictionary, which
	// is more trustworthy than anything scraped from the page.
	const embedded = typeof info?.doi === 'string' ? findDoi(info.doi) : null;
	if (embedded) return { kind: 'doi', value: embedded, source: 'metadata' };

	const doi = findDoi(text);
	if (doi) return { kind: 'doi', value: doi, source: 'text' };

	const arxiv = findArxivId(text);
	if (arxiv) return { kind: 'arxiv', value: arxiv, source: 'text' };

	return null;
}
