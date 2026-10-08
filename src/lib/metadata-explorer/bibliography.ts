import {
	dedupe,
	formatOf,
	readBibliography,
	type ImportEntry,
	type Known,
	type Sorted,
	type Unreadable
} from '$lib/import';
import { describeError } from '$lib/ipc';
import {
	attachFile,
	importSources,
	libraryWorks,
	pdfsFound,
	type ImportedSource
} from '$lib/stores/db';

import type { AugmentedZoteroSchema } from './adapterCslZotero';
import { newSourceId } from './sourceForm';

/**
 * Importing a bibliography (M1b-9, docs/ux.md UX-6): read it and sort it
 * against the library for the preview, which comes before anything is
 * written; then write what's new, a batch at a time, and attach the PDFs it
 * names.
 */

export interface Preview extends Sorted {
	fileName: string;
	/** Every entry the file lists, read or not. */
	total: number;
	unreadable: Unreadable[];
	/** The PDFs the new entries name, each once, as paths to look for. */
	pdfs: string[];
}

/** The file's name, from a path either OS writes. */
export function fileNameOf(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
}

/** The folder a path is in, or '' for a bare name. */
function folderOf(path: string): string {
	return path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'), 0));
}

/**
 * Where a file an entry names is. JabRef and Better BibTeX can write paths
 * relative to the bibliography; the rest are absolute already.
 */
export function resolvePdf(file: string, folder: string): string {
	if (!folder || /^(\/|[a-z]:[\\/]|\\\\)/i.test(file)) return file;
	const separator = /^[a-z]:\\/i.test(folder) || folder.startsWith('\\\\') ? '\\' : '/';
	return `${folder.replace(/[\\/]+$/, '')}${separator}${file.replace(/^\.[\\/]/, '')}`;
}

/**
 * The preview of importing `text`, read from the file at `path` (AC-4).
 * Throws when the file isn't one Erti reads, or is over a limit (M1b-10).
 */
export async function previewImport(path: string, text: string): Promise<Preview> {
	const fileName = fileNameOf(path);
	const format = formatOf(fileName);
	if (!format) throw new Error(`${fileName} isn’t a .bib, .ris or .json file.`);
	const [read, works] = await Promise.all([readBibliography(text, format), libraryWorks()]);
	const sorted = dedupe(works.map(known), read.entries);
	const folder = folderOf(path);
	const fresh = sorted.fresh.map((entry) =>
		entry.files.length ? { ...entry, files: entry.files.map((f) => resolvePdf(f, folder)) } : entry
	);
	return {
		...sorted,
		fresh,
		fileName,
		total: read.entries.length + read.unreadable.length,
		unreadable: read.unreadable,
		pdfs: [...new Set(fresh.flatMap((entry) => entry.files))]
	};
}

/** Rust looks for at most 1,000 at once (`FIND_BATCH`). */
const FIND_BATCH = 1000;

/**
 * Which of the PDFs Erti can attach: those in the project, in a folder the
 * user has shown it, or where the library already has a file. The rest are
 * "not found", whether they're there or not (AC-4).
 */
export async function locatePdfs(
	paths: string[]
): Promise<{ found: Set<string>; missing: string[] }> {
	const found = new Set<string>();
	const missing: string[] = [];
	for (let start = 0; start < paths.length; start += FIND_BATCH) {
		const batch = paths.slice(start, start + FIND_BATCH);
		const answers = await pdfsFound(batch);
		batch.forEach((path, i) => {
			if (answers[i]) found.add(path);
			else missing.push(path);
		});
	}
	return { found, missing };
}

/** The deepest folder holding all of `paths`, to start the folder picker in. */
export function commonFolder(paths: string[]): string | undefined {
	if (paths.length === 0) return undefined;
	const parts = paths.map((path) => folderOf(path).split(/[\\/]/));
	const shared: string[] = [];
	for (let i = 0; parts.every((p) => i < p.length && p[i] === parts[0][i]); i++) {
		shared.push(parts[0][i]);
	}
	const separator = paths[0].includes('/') ? '/' : '\\';
	const folder = shared.join(separator);
	return folder || (shared.length ? separator : undefined);
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

/** A PDF to attach to a source just imported. */
export interface Pdf {
	work: string;
	path: string;
}

/** An attached PDF, and whether it still has to be read. */
export interface AttachedPdf {
	sha256: string;
	path: string;
	file_name: string;
	needs_ingest: boolean;
}

export interface Imported {
	added: string[];
	/** The library gained these between the preview and the import. */
	skipped: number;
	/** The PDFs found for what was added, still to attach. */
	pdfs: Pdf[];
	attached: AttachedPdf[];
	/** PDFs found that couldn't be attached after all, and why. */
	unattached: { path: string; reason: string }[];
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
		found = new Set(),
		onprogress = () => {}
	}: {
		toProject: boolean;
		/** The PDFs that are there to attach (`locatePdfs`). */
		found?: Set<string>;
		onprogress?: (done: number, total: number) => void;
	}
): Promise<Imported> {
	const sources = entries.map((entry) => toSource(entry, schema));
	const named = new Map(
		sources.map((source, i) => [source.id, entries[i].files.filter((f) => found.has(f))])
	);
	const imported: Imported = { added: [], skipped: 0, pdfs: [], attached: [], unattached: [] };
	for (let start = 0; start < sources.length; start += BATCH) {
		let batch;
		try {
			batch = await importSources(sources.slice(start, start + BATCH), toProject);
		} catch (error) {
			throw new ImportStopped(error, imported);
		}
		imported.added.push(...batch.added);
		for (const work of batch.added) {
			for (const path of named.get(work) ?? []) imported.pdfs.push({ work, path });
		}
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

/**
 * Attach the PDFs found for what was imported, one at a time: each is hashed
 * and checked as one attached by hand is (`attach_file`). One that can't be
 * is said, and the rest go on.
 */
export async function attachPdfs(
	imported: Imported,
	onprogress: (done: number, total: number) => void = () => {}
): Promise<Imported> {
	const attached: AttachedPdf[] = [];
	const unattached: Imported['unattached'] = [];
	let done = 0;
	for (const { work, path } of imported.pdfs) {
		try {
			const file = await attachFile(work, path);
			attached.push({
				sha256: file.sha256,
				path,
				file_name: file.file_name,
				needs_ingest: file.needs_ingest
			});
		} catch (error) {
			unattached.push({ path, reason: describeError(error) });
		}
		onprogress(++done, imported.pdfs.length);
	}
	return { ...imported, pdfs: [], attached, unattached };
}
