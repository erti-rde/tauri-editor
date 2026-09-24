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
	/** Position within the source. `sha256:idx` is a result's stable identity. */
	idx: number;
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
	/** Rows a previous run already carried forward. */
	already_present: number;
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

/* ------------------------------------------------------------- annotations */

export type AnnotationKind = 'highlight' | 'area' | 'page-note';

/**
 * How a mark is drawn, not what it means.
 *
 * A highlight and an underline mark the same passage for the same reason —
 * readers use both the way they use two pens — so this is a style rather than
 * another kind.
 */
export type MarkStyle = 'fill' | 'underline';

/** Where a mark came from, so imported ones can be told apart and undone. */
export type AnnotationOrigin = 'erti' | 'imported';

export interface Annotation {
	id: string;
	sha256: string;
	kind: AnnotationKind;
	label_id: string | null;
	page: number;
	/** JSON array of `{x, y, w, h}` in PDF user space. Null for a page note. */
	rects: string | null;
	quote: string | null;
	prefix: string | null;
	suffix: string | null;
	char_start: number | null;
	char_end: number | null;
	note: string | null;
	style: MarkStyle;
	/**
	 * The page number the paper itself prints, when it differs from the sheet.
	 *
	 * `page` is where the mark is in the file. A journal article beginning on
	 * page 843 calls its eleventh sheet 853, and 853 is what a citation has to
	 * say — "p. 11" points at nothing a reader of the journal can find.
	 */
	page_label: string | null;
	origin: AnnotationOrigin;
	created_at: string;
	updated_at: string;
}

/**
 * An annotation on its way in.
 *
 * The id is chosen here rather than by the database, so the same record keeps
 * its identity through an export to a sidecar and back on another machine.
 */
export interface NewAnnotation {
	id: string;
	sha256: string;
	kind: AnnotationKind;
	label_id?: string | null;
	page: number;
	rects?: string | null;
	quote?: string | null;
	prefix?: string | null;
	suffix?: string | null;
	char_start?: number | null;
	char_end?: number | null;
	note?: string | null;
	style?: MarkStyle | null;
	page_label?: string | null;
	origin?: AnnotationOrigin | null;
}

export interface AnnotationLabel {
	id: string;
	name: string;
	/** `H S% L%`, matching the theme tokens rather than a hex string. */
	colour: string;
	position: number;
	enabled: boolean;
}

/** Save an annotation, or update one that already exists. */
export const saveAnnotation = (annotation: NewAnnotation) =>
	invoke<void>('save_annotation', { annotation });

export const annotationsForSource = (sha256: string) =>
	invoke<Annotation[]>('annotations_for_source', { sha256 });

export const allAnnotations = (options: { limit?: number; offset?: number } = {}) =>
	invoke<Annotation[]>('all_annotations', {
		limit: options.limit ?? null,
		offset: options.offset ?? null
	});

export const deleteAnnotation = (id: string) => invoke<void>('delete_annotation', { id });

/** Undo an import, leaving marks the reader made themselves untouched. */
export const deleteImportedAnnotations = (sha256: string) =>
	invoke<number>('delete_imported_annotations', { sha256 });

export const annotationLabels = () => invoke<AnnotationLabel[]>('annotation_labels');

export const saveLabel = (label: AnnotationLabel) => invoke<void>('save_label', { label });

/**
 * Remove a label. Highlights filed under it become unlabelled rather than being
 * deleted — the mark was a judgement about the passage, and losing the colour
 * is not a reason to lose it.
 */
export const deleteLabel = (id: string) => invoke<void>('delete_label', { id });

/**
 * Put back any default labels that are missing, leaving edited ones alone.
 *
 * An explicit action rather than something that happens on open: seeding on
 * every launch is what made a deliberately deleted label reappear the next
 * morning.
 */
export const restoreDefaultLabels = () => invoke<number>('restore_default_labels');

/**
 * Rename every label after the colour it is.
 *
 * For the researcher who does not want Erti's opinion about what their
 * highlights mean. Returns how many changed, so nothing is claimed when nothing
 * happened.
 */
export const nameLabelsAfterColours = () => invoke<number>('name_labels_after_colours');

export const saveReadingPosition = (
	sha256: string,
	page: number,
	scroll?: number | null,
	scale?: string | null
) =>
	invoke<void>('save_reading_position', {
		sha256,
		page,
		scroll: scroll ?? null,
		scale: scale ?? null
	});

export const readingPosition = (sha256: string) =>
	invoke<number | null>('reading_position', { sha256 });

/**
 * The path a paper was last seen at.
 *
 * Null is an ordinary answer: the library records where a hash has been seen
 * rather than owning a copy, so a paper that has moved still cites correctly and
 * only opening it degrades.
 */
export const pathForSource = (sha256: string) =>
	invoke<string | null>('path_for_source', { sha256 });

export const sourceForPath = (path: string) => invoke<string | null>('source_for_path', { path });

export const saveAnnotationImage = (id: string, png: number[]) =>
	invoke<void>('save_annotation_image', { id, png });

export const annotationImage = (id: string) => invoke<number[] | null>('annotation_image', { id });

/**
 * Embed a mark's text so it can be found by meaning.
 *
 * Returns false when nothing needed doing — the text has not changed since it
 * was last embedded, or there is no text to embed. Recolouring a highlight
 * should not cost an inference.
 */
export const embedAnnotation = (id: string, text: string) =>
	invoke<boolean>('embed_annotation', { id, text });

/**
 * Give every mark that has none a vector, and say how many.
 *
 * Marks are embedded as they are made, and that can fail quietly — before a
 * library is open, while the model is loading. A highlight is never lost to it,
 * but the mark then cannot be found by meaning, with nothing to say so.
 */
export const embedPendingAnnotations = () => invoke<number>('embed_pending_annotations');

/** A mark, ranked against what the researcher is looking for. */
export interface ScoredAnnotation extends Annotation {
	/** Cosine similarity for a search by meaning; 1 for a literal match. */
	similarity: number;
	/** False when the mark is on a paper outside the open project. */
	in_project: boolean;
	/** The paper's filename, so a result can say where it came from. */
	file_name: string | null;
}

/**
 * Search the marks.
 *
 * Kept apart from `searchSources` on purpose. A passage from a paper and a note
 * the reader wrote are not the same kind of thing, and a short note does not
 * score comparably against a long passage — merging them into one ranked list
 * would be wrong in a way that never shows.
 */
export const searchAnnotations = (
	query: string,
	options: { limit?: number; semantic?: boolean } = {}
) =>
	invoke<ScoredAnnotation[]>('search_annotations', {
		query,
		limit: options.limit ?? null,
		semantic: options.semantic ?? false
	});
