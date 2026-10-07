import { findDoi } from '$lib/ingest/identifiers';
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

export function doiOf(csl: Record<string, unknown> | null): string | null {
	return typeof csl?.DOI === 'string' ? findDoi(csl.DOI) : null;
}

/** Title, year and first author as one key; null for a work with no title to match on. */
export function titleKeyOf(csl: Record<string, unknown> | null): string | null {
	const title = normalise(csl?.title);
	if (!csl || !title) return null;
	return `${title}|${yearOf(csl.issued) ?? ''}|${firstPerson(csl)}`;
}

export function dedupe(library: Known[], incoming: ImportEntry[]): Sorted {
	const byDoi = new Map<string, string>();
	const byTitle = new Map<string, { id: string; doi: string | null }>();
	for (const { id, csl } of library) {
		const doi = doiOf(csl);
		const key = titleKeyOf(csl);
		if (doi && !byDoi.has(doi)) byDoi.set(doi, id);
		if (key && !byTitle.has(key)) byTitle.set(key, { id, doi });
	}

	const sorted: Sorted = { fresh: [], known: [], repeated: [] };
	const seenDoi = new Map<string, string>();
	const seenTitle = new Map<string, string>();
	for (const entry of incoming) {
		const doi = doiOf(entry.item);
		const key = titleKeyOf(entry.item);
		const inLibrary = doi ? byDoi.get(doi) : undefined;
		if (inLibrary) {
			sorted.known.push({ entry, match: { by: 'doi', id: inLibrary } });
			continue;
		}
		// A DOI that differs says they're different works, whatever their titles.
		const titled = key ? byTitle.get(key) : undefined;
		if (titled && !(doi && titled.doi)) {
			sorted.known.push({ entry, match: { by: 'title', id: titled.id } });
			continue;
		}
		const earlier = (doi && seenDoi.get(doi)) || (key && seenTitle.get(key));
		if (earlier) {
			sorted.repeated.push({ entry, of: earlier });
			continue;
		}
		if (doi) seenDoi.set(doi, entry.key);
		if (key) seenTitle.set(key, entry.key);
		sorted.fresh.push(entry);
	}
	return sorted;
}
