import { plainText, yearOf } from './csl';
import type { ImportEntry } from './types';

/**
 * Which entries of an import the library has already (M1b-9 AC-4, ADR 009):
 * by DOI first, then by normalised title, year and first author.
 */

/** A source in the library, as far as matching needs it. */
export interface Known {
	id: string;
	csl: Record<string, unknown> | null;
}

export type Match = { by: 'doi' | 'title'; id: string };

export interface Sorted {
	/** Not in the library: these are what an import adds. */
	fresh: ImportEntry[];
	/** In the library already, with the source each one is. */
	known: { entry: ImportEntry; match: Match }[];
	/** Listed earlier in the same file, under the key given. */
	repeated: { entry: ImportEntry; of: string }[];
}

/** Letters and digits only, lowercased, accents off: "Übermensch & Co." is "ubermenschco". */
export function normalise(value: unknown): string {
	if (typeof value !== 'string') return '';
	return (plainText(value) ?? '')
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '');
}

function firstPerson(csl: Record<string, unknown>): string {
	for (const role of ['author', 'editor']) {
		const people = csl[role];
		if (Array.isArray(people) && people.length > 0) {
			const first = people[0] as Record<string, unknown>;
			return normalise(first.family ?? first.literal);
		}
	}
	return '';
}

const RESOLVERS = [
	'https://doi.org/',
	'http://doi.org/',
	'https://dx.doi.org/',
	'http://dx.doi.org/',
	'doi:'
];

/**
 * A DOI field as the library compares it (`normalise_doi` in queries.rs):
 * lowercased, without a resolver in front. Nothing else is trimmed: this is a
 * field that holds a DOI, not prose around one, and a suffix may end in a
 * full stop that makes it a different DOI.
 */
export function doiOf(csl: Record<string, unknown> | null): string | null {
	if (typeof csl?.DOI !== 'string') return null;
	const lower = csl.DOI.trim().toLowerCase();
	const resolver = RESOLVERS.find((prefix) => lower.startsWith(prefix));
	const bare = (resolver ? lower.slice(resolver.length) : lower).trim();
	return bare || null;
}

/** Title, year and first author as one key; null for a work with no title to match on. */
export function titleKeyOf(csl: Record<string, unknown> | null): string | null {
	const title = normalise(csl?.title);
	if (!csl || !title) return null;
	return `${title}|${yearOf(csl.issued) ?? ''}|${firstPerson(csl)}`;
}

type Titled = { id: string; doi: string | null };

/**
 * Works with one title key, each with its DOI. All are kept: the first may
 * have a DOI that rules it out where a later one, with none, still matches.
 */
class ByTitle {
	private works = new Map<string, Titled[]>();

	add(key: string | null, work: Titled) {
		if (!key) return;
		const list = this.works.get(key);
		if (list) list.push(work);
		else this.works.set(key, [work]);
	}

	/** The first with this key whose DOI doesn't say it's a different work. */
	match(key: string | null, doi: string | null): string | undefined {
		if (!key) return undefined;
		return this.works.get(key)?.find((work) => !(doi && work.doi))?.id;
	}
}

export function dedupe(library: Known[], incoming: ImportEntry[]): Sorted {
	const byDoi = new Map<string, string>();
	const byTitle = new ByTitle();
	for (const { id, csl } of library) {
		const doi = doiOf(csl);
		if (doi && !byDoi.has(doi)) byDoi.set(doi, id);
		byTitle.add(titleKeyOf(csl), { id, doi });
	}

	const sorted: Sorted = { fresh: [], known: [], repeated: [] };
	const seenDoi = new Map<string, string>();
	const seenTitle = new ByTitle();
	for (const entry of incoming) {
		const doi = doiOf(entry.item);
		const key = titleKeyOf(entry.item);
		const inLibrary = doi ? byDoi.get(doi) : undefined;
		if (inLibrary) {
			sorted.known.push({ entry, match: { by: 'doi', id: inLibrary } });
			continue;
		}
		// A DOI that differs says they're different works, whatever their titles.
		const titled = byTitle.match(key, doi);
		if (titled) {
			sorted.known.push({ entry, match: { by: 'title', id: titled } });
			continue;
		}
		// The same rule within the file: different DOIs, different works.
		const earlier = (doi && seenDoi.get(doi)) || seenTitle.match(key, doi);
		if (earlier) {
			sorted.repeated.push({ entry, of: earlier });
			continue;
		}
		if (doi) seenDoi.set(doi, entry.key);
		seenTitle.add(key, { id: entry.key, doi });
		sorted.fresh.push(entry);
	}
	return sorted;
}
