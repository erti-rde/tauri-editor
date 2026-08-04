/**
 * Turning a PDF into citable metadata.
 *
 * Ordered offline-first. The old pipeline went straight to a Crossref search
 * keyed on the PDF's embedded title and author — routinely empty or junk — and
 * resolved 9% of a real corpus, writing `'{}'` for the rest. That placeholder
 * then looked resolved, so nothing was ever retried.
 *
 * Two rules here follow from that:
 *
 * 1. Look for the paper's own identifier before asking anyone. On the benchmark
 *    corpus this alone identifies every paper with no network call at all.
 * 2. Never invent a result. Failure returns null and is recorded, so it stays
 *    visible and retryable.
 */

import { findIdentifier, type IdentifierHit } from './identifiers';

export type ResolvedVia = 'pdf-doi' | 'pdf-arxiv' | 'crossref' | 'manual' | 'legacy';

export interface ResolvedMetadata {
	/** CSL-JSON, as returned by the resolver. Never empty. */
	csl: Record<string, unknown>;
	via: ResolvedVia;
	doi: string | null;
}

export interface ResolveResult {
	/** Null when nothing citable was obtained. */
	resolved: ResolvedMetadata | null;
	/**
	 * The identifier printed in the document, whether or not it was looked up.
	 *
	 * Kept separate from `resolved` because finding an identifier is not the same
	 * as resolving metadata. Conflating them is how the offline path came to
	 * return `{ DOI: undefined }`, which serialises to `'{}'` — precisely the
	 * placeholder this module exists to stop being stored.
	 */
	identifier: IdentifierHit | null;
}

export interface ResolveOptions {
	/** The PDF's embedded metadata dictionary. */
	info?: { doi?: unknown; Author?: string; Title?: string; author?: string; title?: string };
	/** Text of the first and last pages, where identifiers are printed. */
	text: string;
	/**
	 * Whether outbound requests are permitted.
	 *
	 * With this false the app stays entirely offline: identifiers are still found
	 * in the document, but nothing is looked up and nothing is disclosed about
	 * what is being read.
	 */
	allowNetwork: boolean;
	/** Contact address for Crossref's polite pool. */
	mailto?: string;
	fetchImpl?: typeof fetch;
}

const CSL_ACCEPT = 'application/vnd.citationstyles.csl+json';

/** Requests that hang would stall a whole folder scan. */
const TIMEOUT_MS = 15_000;

async function fetchWithRetry(
	url: string,
	init: RequestInit,
	fetchImpl: typeof fetch
): Promise<Response | null> {
	// Crossref and doi.org both rate-limit; a couple of backed-off retries turn a
	// transient 429 into a success rather than a permanent failure.
	const delays = [0, 1000, 3000];

	for (const delay of delays) {
		if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

			// Cleared in `finally`: on a network error, or on the abort this timer
			// itself fires, control jumps to the catch below and the timer would
			// otherwise stay pending and hold the event loop open.
			let response: Response;
			try {
				response = await fetchImpl(url, { ...init, signal: controller.signal });
			} finally {
				clearTimeout(timer);
			}

			if (response.ok) return response;
			// Only these are worth retrying; a 404 will stay a 404.
			if (response.status !== 429 && response.status < 500) return null;
		} catch {
			// Network error or timeout — fall through to the next attempt.
		}
	}

	return null;
}

/** CSL-JSON for a DOI, straight from the registration agency. */
async function fromDoi(
	doi: string,
	fetchImpl: typeof fetch
): Promise<Record<string, unknown> | null> {
	const response = await fetchWithRetry(
		`https://doi.org/${encodeURI(doi)}`,
		{ headers: { Accept: CSL_ACCEPT } },
		fetchImpl
	);
	if (!response) return null;

	try {
		return (await response.json()) as Record<string, unknown>;
	} catch {
		return null;
	}
}

/**
 * CSL-JSON for an arXiv id.
 *
 * arXiv assigns DataCite DOIs of the form `10.48550/arXiv.<id>`, so the same
 * content-negotiated endpoint serves them and no bespoke API client is needed.
 */
async function fromArxiv(
	id: string,
	fetchImpl: typeof fetch
): Promise<Record<string, unknown> | null> {
	return fromDoi(`10.48550/arXiv.${id}`, fetchImpl);
}

/**
 * Last resort: ask Crossref to find the paper from its bibliographic details.
 *
 * `query.bibliographic` is the field intended for this, rather than the
 * free-text `query` the old code used. The `mailto` parameter puts the request
 * in Crossref's polite pool, which they ask for and which gets better service.
 */
async function fromCrossrefSearch(
	options: ResolveOptions,
	fetchImpl: typeof fetch
): Promise<{ csl: Record<string, unknown>; doi: string } | null> {
	const { info, text, mailto } = options;

	const title = info?.Title ?? info?.title ?? '';
	const author = info?.Author ?? info?.author ?? '';
	// A PDF producer's idea of a title is often the filename it was saved under.
	const looksLikeJunk = /\.(docx?|tex|pages)$|^microsoft word/i.test(title);

	const bibliographic =
		title && !looksLikeJunk ? `${title} ${author}`.trim() : text.slice(0, 400).trim();
	if (bibliographic.length < 12) return null;

	const url = new URL('https://api.crossref.org/works');
	url.searchParams.set('rows', '1');
	url.searchParams.set('select', 'DOI');
	url.searchParams.set('query.bibliographic', bibliographic);
	if (mailto) url.searchParams.set('mailto', mailto);

	const response = await fetchWithRetry(url.toString(), {}, fetchImpl);
	if (!response) return null;

	let doi: string | undefined;
	try {
		const body = (await response.json()) as { message?: { items?: { DOI?: string }[] } };
		doi = body.message?.items?.[0]?.DOI;
	} catch {
		return null;
	}
	if (!doi) return null;

	const csl = await fromDoi(doi, fetchImpl);
	return csl ? { csl, doi } : null;
}

const viaFor = (hit: IdentifierHit): ResolvedVia => (hit.kind === 'doi' ? 'pdf-doi' : 'pdf-arxiv');

/**
 * Resolve a document's metadata, or return null.
 *
 * Null means "not resolved", which is recorded against the source so it can be
 * retried or corrected by hand. It is never stored as empty metadata.
 */
export async function resolveMetadata(options: ResolveOptions): Promise<ResolveResult> {
	const fetchImpl = options.fetchImpl ?? fetch;

	// 1. The document's own identifier — offline, and by far the most reliable.
	const identifier = findIdentifier(options.info, options.text);

	// Without consent nothing can be looked up. The identifier is still reported
	// so the caller can show what was found and offer a retry, but the source is
	// emphatically not resolved.
	if (!options.allowNetwork) return { resolved: null, identifier };

	if (identifier) {
		const csl =
			identifier.kind === 'doi'
				? await fromDoi(identifier.value, fetchImpl)
				: await fromArxiv(identifier.value, fetchImpl);

		if (csl && hasTitle(csl)) {
			return {
				resolved: {
					csl,
					via: viaFor(identifier),
					doi: typeof csl.DOI === 'string' ? csl.DOI : null
				},
				identifier
			};
		}
	}

	// 2. Only now guess, and only from bibliographic fields.
	const searched = await fromCrossrefSearch(options, fetchImpl);
	if (searched && hasTitle(searched.csl)) {
		return {
			resolved: { csl: searched.csl, via: 'crossref', doi: searched.doi },
			identifier
		};
	}

	return { resolved: null, identifier };
}

/** A record without a title cannot be cited, so it does not count as resolved. */
function hasTitle(csl: Record<string, unknown>): boolean {
	const title = csl.title;
	if (typeof title === 'string') return title.trim().length > 0;
	if (Array.isArray(title)) return title.length > 0 && String(title[0]).trim().length > 0;
	return false;
}
