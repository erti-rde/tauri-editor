import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

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

export type Loaded =
	/** A document. */
	| { status: 'ok'; content: Content }
	/** No file yet: a blank document, saved on the first edit. */
	| { status: 'missing'; content: Content }
	/** A file with nothing in it, or the `undefined` very old builds wrote. */
	| { status: 'empty'; content: Content }
	/** A file that isn't a document. Shown blank, and never saved over. */
	| { status: 'unreadable'; content: Content; error: unknown };

/** A manuscript's text as a document, or why it isn't one. */
export function parseManuscript(text: string): Loaded {
	if (!text.trim() || text === 'undefined') return { status: 'empty', content: {} };
	try {
		return { status: 'ok', content: JSON.parse(text) };
	} catch (error) {
		return { status: 'unreadable', content: {}, error };
	}
}

export function serialiseManuscript(content: unknown): string {
	return JSON.stringify(content);
}

export async function loadManuscript(path: string, files: ManuscriptFiles): Promise<Loaded> {
	if (!(await files.exists(path))) return { status: 'missing', content: {} };
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
		await files.write(path, serialiseManuscript({ type: 'doc', content: [] }), {
			createNew: true
		});
		return { created: true };
	} catch (error) {
		return { created: false, error };
	}
}

/** The files one editor opens and saves, with the read-failed guard. */
export interface ManuscriptSession {
	/** Load a manuscript. An unreadable one is protected from saves until `reset`. */
	open(path: string): Promise<Loaded>;
	/** Write, unless this path couldn't be read. False when refused. */
	save(path: string, content: unknown): Promise<boolean>;
	create(path: string): ReturnType<typeof createManuscript>;
	exists(path: string): Promise<boolean>;
	/** Whether edits to this path may be saved. */
	mayWrite(path: string | undefined): boolean;
	/** A different document is in the editor now; lift the guard. */
	reset(): void;
}

export function createManuscriptSession(files: ManuscriptFiles = tauriFiles): ManuscriptSession {
	// The path rather than a flag: the guard belongs to the file that failed,
	// and must not follow the editor to the next document or stop there early.
	let unreadable: string | null = null;

	return {
		async open(path) {
			const loaded = await loadManuscript(path, files);
			unreadable = loaded.status === 'unreadable' ? path : null;
			return loaded;
		},
		async save(path, content) {
			if (path === unreadable) return false;
			await files.write(path, serialiseManuscript(content));
			return true;
		},
		create: (path) => createManuscript(path, files),
		exists: (path) => files.exists(path),
		mayWrite: (path) => path !== undefined && path !== unreadable,
		reset() {
			unreadable = null;
		}
	};
}
