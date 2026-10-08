import {
	dedupe,
	formatOf,
	readBibliography,
	type ImportEntry,
	type Known,
	type Sorted,
	type Unreadable
} from '$lib/import';
import { importSources, libraryWorks, type ImportedSource } from '$lib/stores/db';

import type { AugmentedZoteroSchema } from './adapterCslZotero';
import { newSourceId } from './sourceForm';

/**
 * Importing a bibliography (M1b-9, docs/ux.md UX-6): read it and sort it
 * against the library for the preview, which comes before anything is
 * written; then write what's new, a batch at a time.
 */

export interface Preview extends Sorted {
	fileName: string;
	/** Every entry the file lists, read or not. */
	total: number;
	unreadable: Unreadable[];
}

/** The file's name, from a path either OS writes. */
export function fileNameOf(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
}

/**
 * The preview of importing `text`, read from a file called `fileName` (AC-4).
 * Throws when the file isn't one Erti reads, or is over a limit (M1b-10).
 */
export async function previewImport(fileName: string, text: string): Promise<Preview> {
	const format = formatOf(fileName);
	if (!format) throw new Error(`${fileName} isn’t a .bib, .ris or .json file.`);
	const [read, works] = await Promise.all([readBibliography(text, format), libraryWorks()]);
	const sorted = dedupe(works.map(known), read.entries);
	return {
		...sorted,
		fileName,
		total: read.entries.length + read.unreadable.length,
		unreadable: read.unreadable
	};
}

/**
 * A work as `dedupe` matches it. The DOI column wins over the details' own:
 * a PDF's DOI is often only there.
 */
function known(work: { id: string; csl_json: string | null; doi: string | null }): Known {
	let csl: Record<string, unknown> | null = null;
	try {
		const parsed: unknown = work.csl_json ? JSON.parse(work.csl_json) : null;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			csl = parsed as Record<string, unknown>;
		}
	} catch {
		// Damaged details match on the DOI alone, if it has one.
	}
	if (work.doi) csl = { ...csl, DOI: work.doi };
	return { id: work.id, csl };
}

/**
 * An entry as the library keeps it: a work with an id of Erti's and a kind the
 * form knows, so its sidebar shows its fields. A CSL type with no Zotero kind
 * is kept as a document, as one from a DOI is (`fromDoi.ts`).
 */
export function toSource(entry: ImportEntry, schema: AugmentedZoteroSchema): ImportedSource {
	const id = newSourceId();
	const csl: Record<string, unknown> = { ...entry.item, id };
	let zoteroType = schema.cslToZoteroTypeMap.get(String(csl.type ?? ''));
	if (!zoteroType) {
		csl.type = 'document';
		zoteroType = 'document';
	}
	csl.zotero_type = zoteroType;
	return { id, csl_json: JSON.stringify(csl), zotero_type: zoteroType };
}

/** Rust takes at most 500 at a time (`IMPORT_BATCH`); fewer, so progress moves. */
export const BATCH = 250;

export interface Imported {
	added: string[];
	/** The library gained these between the preview and the import. */
	skipped: number;
}

/**
 * Write the new entries, a batch at a time, saying how far it's got after
 * each (AC-6). A batch that fails stops the import; what was added before it
 * stays added, and is in the error's `added`.
 */
export async function importEntries(
	entries: ImportEntry[],
	schema: AugmentedZoteroSchema,
	{
		toProject,
		onprogress = () => {}
	}: { toProject: boolean; onprogress?: (done: number, total: number) => void }
): Promise<Imported> {
	const sources = entries.map((entry) => toSource(entry, schema));
	const imported: Imported = { added: [], skipped: 0 };
	for (let start = 0; start < sources.length; start += BATCH) {
		let batch;
		try {
			batch = await importSources(sources.slice(start, start + BATCH), toProject);
		} catch (error) {
			throw new ImportStopped(error, imported);
		}
		imported.added.push(...batch.added);
		imported.skipped += batch.skipped.length;
		onprogress(Math.min(start + BATCH, sources.length), sources.length);
	}
	return imported;
}

/** An import that stopped part way, with what it had added by then. */
export class ImportStopped extends Error {
	constructor(
		readonly reason: unknown,
		readonly imported: Imported
	) {
		super('The import stopped part way.');
	}
}
