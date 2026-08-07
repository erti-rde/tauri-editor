import type { FileItem } from '$lib/stores/fileSystem.svelte';

/**
 * The manuscripts in a project.
 *
 * Erti wrote to one hardcoded `magnum_opus.json` per folder, so a project could
 * hold exactly one piece of writing. That is wrong for how research is actually
 * done: a thesis has chapters, a paper has a draft and a response to reviewers,
 * and a project folder usually holds several related pieces at once.
 *
 * **The folder is the source of truth**, not a table in the project database.
 * The plan sketched a `documents` table, and the schema still has one, but a
 * list kept in a database can disagree with the disk — a file copied in from a
 * co-author, renamed in Finder, or restored from a backup would be invisible,
 * and one deleted outside the app would linger. Project folders are meant to be
 * portable and self-describing, which only holds if what is in the folder is
 * what the project contains. The table is left for per-document metadata that
 * has nowhere else to live.
 */

/** Marks a file as an Erti manuscript rather than any other JSON. */
export const DOCUMENT_EXTENSION = '.erti.json';

/**
 * The single document every pre-existing project has.
 *
 * Recognised so that upgrading does not hide someone's work behind a rename
 * they did not ask for. It is listed like any other manuscript.
 */
export const LEGACY_DOCUMENT = 'magnum_opus.json';

export interface ProjectDocument {
	/** File name including the extension. */
	fileName: string;
	/** Absolute path, for reading and writing. */
	path: string;
	/** What to show in a list: the name without Erti's extension. */
	title: string;
	/** Whether this is the pre-multi-document file. */
	legacy: boolean;
}

export function isDocumentFile(fileName: string): boolean {
	return fileName.endsWith(DOCUMENT_EXTENSION) || fileName === LEGACY_DOCUMENT;
}

function titleOf(fileName: string): string {
	if (fileName === LEGACY_DOCUMENT) return 'Untitled document';
	return fileName.slice(0, -DOCUMENT_EXTENSION.length);
}

/**
 * The manuscripts directly inside the project folder.
 *
 * Deliberately not recursive. A `sources/` directory of PDFs is normal, and a
 * manuscript found three levels down in someone's unrelated subfolder would be
 * a surprise rather than a convenience.
 */
export function listDocuments(items: readonly FileItem[]): ProjectDocument[] {
	return items
		.filter((item) => !item.is_dir && isDocumentFile(item.name))
		.map((item) => ({
			fileName: item.name,
			path: item.path,
			title: titleOf(item.name),
			legacy: item.name === LEGACY_DOCUMENT
		}))
		.sort((a, b) => {
			// The legacy document first: for an upgrading project it is the only
			// one, and it is what the user expects to see when they open the app.
			if (a.legacy !== b.legacy) return a.legacy ? -1 : 1;
			return a.title.localeCompare(b.title);
		});
}

/**
 * Characters no filesystem Erti targets will accept in a name.
 *
 * No `g` flag: a global regex keeps `lastIndex` between `test` calls, so
 * consecutive checks alternate between matching and not, which let a
 * backslash through immediately after a slash was rejected. Spaces are
 * absent on purpose, since "Chapter One" is exactly what someone will type.
 */
// Control characters are exactly what has to be rejected here: a filename
// containing one is invalid on every filesystem Erti targets, and it arrives
// by paste rather than by typing.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]/;

export interface NameResult {
	ok: boolean;
	/** The filename to use, when ok. */
	fileName?: string;
	/** Why it was refused, when not ok. */
	reason?: string;
}

/**
 * Turn what the user typed into a filename.
 *
 * Rejecting rather than silently rewriting where the result would not be what
 * they asked for: a document quietly saved under a different name is how people
 * lose track of their own work.
 */
export function toDocumentFileName(input: string, existing: readonly string[] = []): NameResult {
	const trimmed = input.trim();

	if (trimmed.length === 0) {
		return { ok: false, reason: 'Give the document a name.' };
	}

	if (UNSAFE.test(trimmed)) {
		return {
			ok: false,
			reason: 'A document name cannot contain \\ / : * ? " < > or |.'
		};
	}

	// Reserved on Windows, and a project folder is meant to be shareable across
	// machines rather than only openable on the one it was made on.
	if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(trimmed)) {
		return { ok: false, reason: `"${trimmed}" is a reserved name on Windows.` };
	}

	if (trimmed.startsWith('.')) {
		return { ok: false, reason: 'A document name cannot start with a dot.' };
	}

	// Leaves room for the extension and the path around it.
	if (trimmed.length > 120) {
		return { ok: false, reason: 'That name is too long.' };
	}

	const base = trimmed.endsWith(DOCUMENT_EXTENSION)
		? trimmed.slice(0, -DOCUMENT_EXTENSION.length)
		: trimmed;
	const fileName = `${base}${DOCUMENT_EXTENSION}`;

	if (existing.some((name) => name.toLowerCase() === fileName.toLowerCase())) {
		// Case-insensitively, because macOS and Windows filesystems usually are,
		// and overwriting a co-author's chapter is not a recoverable mistake.
		return { ok: false, reason: `A document called "${base}" is already here.` };
	}

	return { ok: true, fileName };
}

/** The document to open when a project is opened. */
export function defaultDocument(documents: readonly ProjectDocument[]): ProjectDocument | null {
	return documents[0] ?? null;
}
