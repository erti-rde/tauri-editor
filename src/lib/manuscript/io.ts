import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

import { checkSize, type CslItem } from '$lib/guard';
import { APP_VERSION } from '$lib/version';

import { readManuscript, writeManuscript } from './format';

/**
 * Reading and writing manuscripts (ADR 001, M1a-7).
 *
 * Everything that decides what a manuscript file means lives here rather than
 * in `Editor.svelte`: what counts as empty, what counts as unreadable, and the
 * one rule that matters most — a file that couldn't be parsed is never written
 * over, since saving would replace whatever was recoverable with a blank
 * document. The editor decides what to say about it; this decides what's safe.
 *
 * No Svelte. File access is passed in, so the rules are tested without Tauri.
 */

export interface ManuscriptFiles {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, text: string, options?: { createNew?: boolean }): Promise<void>;
}

export const tauriFiles: ManuscriptFiles = {
	exists: (path) => exists(path),
	read: (path) => readTextFile(path),
	write: (path, text, options) => writeTextFile(path, text, options)
};

/** The content an editor starts from when there's nothing to load. */
export type Content = Record<string, unknown>;

type Sources = Record<string, CslItem>;

export type Loaded =
	/** A document, and the sources it carries. `format` 0 is a file from before 1.0. */
	| { status: 'ok'; content: Content; sources: Sources; format: number }
	/** Saved by a newer Erti: shown, never saved over (M1a-8 AC-4). */
	| { status: 'newer'; content: Content; sources: Sources; format: number; savedWith?: string }
	/** No file yet: a blank document, saved on the first edit. */
	| { status: 'missing'; content: Content; sources: Sources }
	/** A file with nothing in it, or the `undefined` very old builds wrote. */
	| { status: 'empty'; content: Content; sources: Sources }
	/** A file that isn't a document, or is hostile. Shown blank, and never saved over. */
	| { status: 'unreadable'; content: Content; sources: Sources; error: unknown };

/** A manuscript's text as a document, or why it isn't one. */
export function parseManuscript(text: string): Loaded {
	if (!text.trim() || text === 'undefined') return { status: 'empty', content: {}, sources: {} };
	try {
		// Refused before parsing: a 500 MB file shouldn't get as far as JSON.parse.
		checkSize(new TextEncoder().encode(text).length, 'manuscriptBytes');
		const manuscript = readManuscript(JSON.parse(text));
		return manuscript.newer
			? {
					status: 'newer',
					content: manuscript.doc,
					sources: manuscript.sources,
					format: manuscript.format,
					savedWith: manuscript.savedWith
				}
			: {
					status: 'ok',
					content: manuscript.doc,
					sources: manuscript.sources,
					format: manuscript.format
				};
	} catch (error) {
		return { status: 'unreadable', content: {}, sources: {}, error };
	}
}

export function serialiseManuscript(content: unknown): string {
	return JSON.stringify(content);
}

export async function loadManuscript(path: string, files: ManuscriptFiles): Promise<Loaded> {
	if (!(await files.exists(path))) return { status: 'missing', content: {}, sources: {} };
	return parseManuscript(await files.read(path));
}

/**
 * An empty manuscript, written only if the name is genuinely free.
 *
 * `createNew` rather than checking first: the gap between looking and writing
 * is enough to overwrite a file that appeared in between, and losing a
 * co-author's chapter to that race isn't recoverable. The filesystem decides.
 */
export async function createManuscript(
	path: string,
	files: ManuscriptFiles
): Promise<{ created: true } | { created: false; error: unknown }> {
	try {
		await files.write(
			path,
			serialiseManuscript(writeManuscript({ type: 'doc', content: [] }, {}, APP_VERSION)),
			{ createNew: true }
		);
		return { created: true };
	} catch (error) {
		return { created: false, error };
	}
}

/** The files one editor opens and saves, with the read-failed guard. */
export interface ManuscriptSession {
	/**
	 * Load a manuscript. One that couldn't be read, or was saved by a newer
	 * Erti, is protected from saves until `reset`.
	 */
	open(path: string): Promise<Loaded>;
	/**
	 * Write the document with a snapshot of the sources it cites, unless this
	 * path is protected. False when refused.
	 */
	save(path: string, doc: unknown, sources: Sources): Promise<boolean>;
	create(path: string): ReturnType<typeof createManuscript>;
	exists(path: string): Promise<boolean>;
	/** Whether edits to this path may be saved. */
	mayWrite(path: string | undefined): boolean;
	/** A different document is in the editor now; lift the guard. */
	reset(): void;
}

/** Where a format-0 file is copied before its first format-1 save (M1a-8 AC-7). */
export const format0Backup = (path: string) => `${path}.format0.bak`;

export function createManuscriptSession(
	files: ManuscriptFiles = tauriFiles,
	savedWith: string = APP_VERSION
): ManuscriptSession {
	// The path rather than a flag: the guard belongs to the file that failed,
	// and must not follow the editor to the next document or stop there early.
	let refused: string | null = null;
	// A pre-1.0 file, and its text as it was, until the first save upgrades it.
	let upgrading: { path: string; text: string } | null = null;

	return {
		async open(path) {
			const loaded = await loadManuscript(path, files);
			refused = loaded.status === 'unreadable' || loaded.status === 'newer' ? path : null;
			upgrading =
				loaded.status === 'ok' && loaded.format === 0
					? { path, text: await files.read(path) }
					: null;
			return loaded;
		},
		async save(path, doc, sources) {
			if (path === refused) return false;

			// Until version history (M5-1) exists, the copy beside the file is
			// the way back to what an older Erti wrote. Never over an earlier one:
			// the first copy is the one worth keeping.
			if (upgrading?.path === path) {
				await files.write(format0Backup(path), upgrading.text, { createNew: true }).catch(() => {});
				upgrading = null;
			}

			await files.write(
				path,
				serialiseManuscript(writeManuscript(doc as Content, sources, savedWith))
			);
			return true;
		},
		create: (path) => createManuscript(path, files),
		exists: (path) => files.exists(path),
		mayWrite: (path) => path !== undefined && path !== refused,
		reset() {
			refused = null;
			upgrading = null;
		}
	};
}
