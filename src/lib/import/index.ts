import { checkSize, guardCslItem, LIMITS, LimitError } from '$lib/guard';
import { parseCslJson } from './cslJson';
import { parseRis } from './ris';
import type { ImportEntry, Parsed, Unreadable } from './types';

export { dedupe, type Known, type Match, type Sorted } from './dedupe';
export type { ImportEntry, Parsed, Unreadable } from './types';

/**
 * Reading a bibliography to import (M1b-9, ADR 009): `.bib`, `.ris` or
 * CSL-JSON `.json`, as CSL-JSON items that nothing has written yet. What the
 * library has already is `dedupe`'s to say, and writing is the caller's.
 */

export type Format = 'bibtex' | 'ris' | 'csl-json';

const FORMATS: Record<string, Format> = {
	bib: 'bibtex',
	bibtex: 'bibtex',
	ris: 'ris',
	json: 'csl-json'
};

/** The extensions the file picker offers. */
export const EXTENSIONS = Object.keys(FORMATS);

/** A file's format, by its extension. */
export function formatOf(fileName: string): Format | null {
	const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
	return fileName.includes('.') ? (FORMATS[extension] ?? null) : null;
}

const NAMES: Record<Format, string> = {
	bibtex: 'BibTeX',
	ris: 'RIS',
	'csl-json': 'CSL-JSON'
};

/**
 * Every entry in `text`, read as `format`, through the shape guard (M1b-10).
 *
 * Throws `LimitError` for a file too big or too long to import; an entry that
 * can't be read is listed in `unreadable` with where it is and why, and the
 * rest are read anyway.
 */
export async function readBibliography(text: string, format: Format): Promise<Parsed> {
	checkSize(new TextEncoder().encode(text).length, 'bibliographyBytes');

	let parsed: Parsed;
	try {
		if (format === 'bibtex') {
			// Loaded here and only here: it's most of an import's weight, and
			// nothing before the first import needs it (AC-5).
			const { parseBibtex } = await import('./bibtex');
			parsed = parseBibtex(text);
		} else if (format === 'ris') {
			parsed = parseRis(text);
		} else {
			parsed = parseCslJson(text);
		}
	} catch (error) {
		if (error instanceof LimitError) throw error;
		return {
			entries: [],
			unreadable: [{ key: null, line: null, reason: `Erti couldn’t read it as ${NAMES[format]}.` }]
		};
	}

	const total = parsed.entries.length + parsed.unreadable.length;
	if (total > LIMITS.importEntries) {
		throw new LimitError(
			'importEntries',
			`Erti imports at most ${LIMITS.importEntries.toLocaleString('en-GB')} sources at once; this file has ${total.toLocaleString('en-GB')}.`
		);
	}

	const entries: ImportEntry[] = [];
	const unreadable: Unreadable[] = [...parsed.unreadable];
	for (const entry of parsed.entries) {
		let item;
		try {
			item = guardCslItem(entry.item);
		} catch (error) {
			// One entry over a limit is left out, not the whole file.
			if (!(error instanceof LimitError)) throw error;
			unreadable.push({ key: entry.key, line: entry.line, reason: error.message });
			continue;
		}
		// The file's own id is its key; the source gets an id of Erti's.
		delete item.id;
		if (typeof item.title !== 'string' || !item.title.trim()) {
			unreadable.push({ key: entry.key, line: entry.line, reason: 'It has no title.' });
			continue;
		}
		const files = entry.files.filter((path) => path.length <= LIMITS.field);
		entries.push({ ...entry, item, files });
	}
	unreadable.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));
	return { entries, unreadable };
}
