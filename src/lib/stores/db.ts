import { invoke } from '@tauri-apps/api/core';

/**
 * Typed client for the database.
 *
 * Every call is a named Rust command. Nothing here sends SQL, which is what
 * allows `sql:default` and `sql:allow-execute` to stay out of the app's
 * capabilities — previously any frontend code could run arbitrary statements
 * through `executeQuery(anyString)`, and the statement/read routing this file
 * used to do is gone with it.
 */

export interface Source {
	sha256: string;
	file_name: string;
	path: string | null;
	/** CSL-JSON, with any project-local override already applied. */
	csl_json: string | null;
	zotero_type: string | null;
	doi: string | null;
	resolved_via: string | null;
	state: 'pending' | 'ready' | 'failed';
	last_error: string | null;
}

export interface NewChunk {
	text: string;
	embedding: number[];
	page_start?: number | null;
	page_end?: number | null;
	section?: string | null;
	char_start?: number | null;
	char_end?: number | null;
}

export interface ScoredChunk {
	sha256: string;
	text: string;
	page_start: number | null;
	section: string | null;
	similarity: number;
	/** False when the chunk comes from outside the current project's source set. */
	in_project: boolean;
}

/** Open the shared source library, creating it on first run. */
export const openLibrary = (path: string) => invoke<void>('open_library', { path });

/** Open a project folder, creating `<root>/.erti/project.db` if needed. */
export const openProject = (root: string) => invoke<void>('open_project', { root });

export const projectRoot = () => invoke<string>('project_root');

/** SHA-256 of a file's contents; the identity a source is stored under. */
export const hashFile = (path: string) => invoke<string>('hash_file', { path });

/**
 * Record a source and add it to the open project.
 *
 * Resolves true when the hash was new to the library, meaning the file still
 * needs extracting and embedding. False means another project already ingested
 * it and its chunks can be reused as-is.
 */
export const registerSource = (sha256: string, path: string, fileName: string) =>
	invoke<boolean>('register_source', { sha256, path, fileName });

/** Hashes still needing ingest, including ones that previously failed. */
export const sourcesNeedingIngest = () => invoke<string[]>('sources_needing_ingest');

export const storeChunks = (sha256: string, chunks: NewChunk[]) =>
	invoke<void>('store_chunks', { sha256, chunks });

export const markIngestFailed = (sha256: string, error: string) =>
	invoke<void>('mark_ingest_failed', { sha256, error });

export const setSourceMetadata = (args: {
	sha256: string;
	cslJson: string;
	zoteroType?: string | null;
	doi?: string | null;
	resolvedVia: string;
}) => invoke<void>('set_source_metadata', args);

/** Sources in the open project, with project-local overrides applied. */
export const projectSources = () => invoke<Source[]>('project_sources');

export const addToProject = (sha256: string) => invoke<void>('add_to_project', { sha256 });

/** Correct a source's metadata for this project only, leaving the library's copy alone. */
export const setMetadataOverride = (sha256: string, cslJson: string) =>
	invoke<void>('set_metadata_override', { sha256, cslJson });

/**
 * Rank sources against text the user is writing.
 *
 * Embedding and cosine both happen in Rust; only the top results cross the IPC
 * boundary. `includeLibrary` widens the search past the project's own sources,
 * and results carry `in_project` so those can still be listed first.
 */
export const searchSources = (query: string, opts?: { limit?: number; includeLibrary?: boolean }) =>
	invoke<ScoredChunk[]>('search_sources', {
		query,
		limit: opts?.limit,
		includeLibrary: opts?.includeLibrary
	});

/** The model that produced the stored vectors, or null if nothing is stored yet. */
export const embeddingMeta = () => invoke<[string, number] | null>('embedding_meta');

export const setEmbeddingMeta = (modelId: string, dims: number) =>
	invoke<void>('set_embedding_meta', { modelId, dims });

export interface SalvageReport {
	imported: number;
	skipped_empty: number;
	skipped_unprocessed: number;
}

/**
 * Carry metadata forward from the pre-hybrid database, if one exists.
 *
 * The old schema stored a filename and no path, so its PDFs cannot be located or
 * hashed; what can be saved is the metadata that genuinely resolved, keyed by
 * filename and applied when a file of that name is next ingested. Rows that were
 * `'{}'` placeholders are deliberately not imported — those are what made
 * failures look resolved and never get retried.
 *
 * The old database is only read, and stays on disk.
 */
export const importLegacyMetadata = (legacyDbPath: string) =>
	invoke<SalvageReport>('import_legacy_metadata', { legacyDbPath });

/** Metadata previously resolved for this filename, if any. */
export const legacyMetadataFor = (fileName: string) =>
	invoke<string | null>('legacy_metadata_for', { fileName });

export const markLegacyConsumed = (fileName: string) =>
	invoke<void>('mark_legacy_consumed', { fileName });
