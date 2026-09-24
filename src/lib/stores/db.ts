import { call, commands, run } from '$lib/ipc';
import type * as ipc from '$lib/ipc';

/**
 * Typed client for the database.
 *
 * Every call is a named Rust command. Nothing here sends SQL, which is what
 * allows `sql:default` and `sql:allow-execute` to stay out of the app's
 * capabilities — previously any frontend code could run arbitrary statements
 * through `executeQuery(anyString)`, and the statement/read routing this file
 * used to do is gone with it.
 *
 * The types come from the generated bindings (ADR 011), so a field added or
 * renamed in Rust fails to compile here rather than arriving as `undefined`.
 * A few string fields are narrowed to the values the database's CHECK
 * constraints allow; each narrowing says which constraint it relies on.
 */

/** Ingest state, as `ingest_status.state`'s CHECK constraint allows. */
export type IngestState = 'pending' | 'ready' | 'failed';

export type Source = Omit<ipc.Source, 'state'> & { state: IngestState };

export type NewChunk = ipc.NewChunk;

/**
 * A scored passage. `similarity` is never null in practice: cosine similarity
 * returns 0 for a zero vector rather than NaN.
 */
export type ScoredChunk = Omit<ipc.ScoredChunk, 'similarity'> & { similarity: number };

/** Open the shared source library, creating it on first run. */
export const openLibrary = (path: string) => run(commands.openLibrary(path));

/** Open a project folder, creating `<root>/.erti/project.db` if needed. */
export const openProject = (root: string) => run(commands.openProject(root));

export const projectRoot = () => call(commands.projectRoot());

/** SHA-256 of a file's contents; the identity a source is stored under. */
export const hashFile = (path: string) => call(commands.hashFile(path));

/**
 * Record a source and add it to the open project.
 *
 * Resolves true when the hash was new to the library, meaning the file still
 * needs extracting and embedding. False means another project already ingested
 * it and its chunks can be reused as-is.
 */
export const registerSource = (sha256: string, path: string, fileName: string) =>
	call(commands.registerSource(sha256, path, fileName));

/** Hashes still needing ingest, including ones that previously failed. */
export const sourcesNeedingIngest = () => call(commands.sourcesNeedingIngest());

export const storeChunks = (sha256: string, chunks: NewChunk[]) =>
	run(commands.storeChunks(sha256, chunks));

export const markIngestFailed = (sha256: string, error: string) =>
	run(commands.markIngestFailed(sha256, error));

export const setSourceMetadata = (args: {
	sha256: string;
	cslJson: string;
	zoteroType?: string | null;
	doi?: string | null;
	resolvedVia: string;
}) =>
	run(
		commands.setSourceMetadata(
			args.sha256,
			args.cslJson,
			args.zoteroType ?? null,
			args.doi ?? null,
			args.resolvedVia
		)
	);

/** Sources in the open project, with project-local overrides applied. */
export const projectSources = () => call(commands.projectSources()) as Promise<Source[]>;

export const addToProject = (sha256: string) => run(commands.addToProject(sha256));

/** Correct a source's metadata for this project only, leaving the library's copy alone. */
export const setMetadataOverride = (sha256: string, cslJson: string) =>
	run(commands.setMetadataOverride(sha256, cslJson));

/**
 * Rank sources against text the user is writing.
 *
 * Embedding and cosine both happen in Rust; only the top results cross the IPC
 * boundary. `includeLibrary` widens the search past the project's own sources,
 * and results carry `in_project` so those can still be listed first.
 */
export const searchSources = (query: string, opts?: { limit?: number; includeLibrary?: boolean }) =>
	call(commands.searchSources(query, opts?.limit ?? null, opts?.includeLibrary ?? null)) as Promise<
		ScoredChunk[]
	>;

/** The model that produced the stored vectors, or null if nothing is stored yet. */
export const embeddingMeta = () => call(commands.embeddingMeta());

export const setEmbeddingMeta = (modelId: string, dims: number) =>
	run(commands.setEmbeddingMeta(modelId, dims));

export type SalvageReport = ipc.SalvageReport;

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
	call(commands.importLegacyMetadata(legacyDbPath));

/** Metadata previously resolved for this filename, if any. */
export const legacyMetadataFor = (fileName: string) => call(commands.legacyMetadataFor(fileName));

export const markLegacyConsumed = (fileName: string) => run(commands.markLegacyConsumed(fileName));

/* ------------------------------------------------------------- annotations */

/** As `annotations.kind`'s CHECK constraint allows. */
export type AnnotationKind = 'highlight' | 'area' | 'page-note';

/**
 * How a mark is drawn, not what it means, as `annotations.style`'s CHECK
 * constraint allows.
 *
 * A highlight and an underline mark the same passage for the same reason —
 * readers use both the way they use two pens — so this is a style rather than
 * another kind.
 */
export type MarkStyle = 'fill' | 'underline';

/**
 * Where a mark came from, so imported ones can be told apart and undone, as
 * `annotations.origin`'s CHECK constraint allows.
 */
export type AnnotationOrigin = 'erti' | 'imported';

/**
 * A mark on a paper.
 *
 * `page` is where the mark is in the file; `page_label` is the page number the
 * paper itself prints, when it differs. A journal article beginning on page 843
 * calls its eleventh sheet 853, and 853 is what a citation has to say.
 */
export type Annotation = Omit<ipc.Annotation, 'kind' | 'style' | 'origin'> & {
	kind: AnnotationKind;
	style: MarkStyle;
	origin: AnnotationOrigin;
};

/**
 * An annotation on its way in.
 *
 * The id is chosen here rather than by the database, so the same record keeps
 * its identity through an export to a sidecar and back on another machine.
 */
export type NewAnnotation = Omit<ipc.NewAnnotation, 'kind' | 'style' | 'origin'> & {
	kind: AnnotationKind;
	style?: MarkStyle | null;
	origin?: AnnotationOrigin | null;
};

export type AnnotationLabel = ipc.AnnotationLabel;

/** Save an annotation, or update one that already exists. */
export const saveAnnotation = (annotation: NewAnnotation) =>
	run(commands.saveAnnotation(annotation));

export const annotationsForSource = (sha256: string) =>
	call(commands.annotationsForSource(sha256)) as Promise<Annotation[]>;

export const allAnnotations = (options: { limit?: number; offset?: number } = {}) =>
	call(commands.allAnnotations(options.limit ?? null, options.offset ?? null)) as Promise<
		Annotation[]
	>;

export const deleteAnnotation = (id: string) => run(commands.deleteAnnotation(id));

/** Undo an import, leaving marks the reader made themselves untouched. */
export const deleteImportedAnnotations = (sha256: string) =>
	call(commands.deleteImportedAnnotations(sha256));

export const annotationLabels = () => call(commands.annotationLabels());

export const saveLabel = (label: AnnotationLabel) => run(commands.saveLabel(label));

/**
 * Remove a label. Highlights filed under it become unlabelled rather than being
 * deleted — the mark was a judgement about the passage, and losing the colour
 * is not a reason to lose it.
 */
export const deleteLabel = (id: string) => run(commands.deleteLabel(id));

/**
 * Put back any default labels that are missing, leaving edited ones alone.
 *
 * An explicit action rather than something that happens on open: seeding on
 * every launch is what made a deliberately deleted label reappear the next
 * morning.
 */
export const restoreDefaultLabels = () => call(commands.restoreDefaultLabels());

/**
 * Rename every label after the colour it is.
 *
 * For the researcher who does not want Erti's opinion about what their
 * highlights mean. Returns how many changed, so nothing is claimed when nothing
 * happened.
 */
export const nameLabelsAfterColours = () => call(commands.nameLabelsAfterColours());

export const saveReadingPosition = (
	sha256: string,
	page: number,
	scroll?: number | null,
	scale?: string | null
) => run(commands.saveReadingPosition(sha256, page, scroll ?? null, scale ?? null));

export const readingPosition = (sha256: string) => call(commands.readingPosition(sha256));

/**
 * The path a paper was last seen at.
 *
 * Null is an ordinary answer: the library records where a hash has been seen
 * rather than owning a copy, so a paper that has moved still cites correctly and
 * only opening it degrades.
 */
export const pathForSource = (sha256: string) => call(commands.pathForSource(sha256));

export const sourceForPath = (path: string) => call(commands.sourceForPath(path));

export const saveAnnotationImage = (id: string, png: number[]) =>
	run(commands.saveAnnotationImage(id, png));

export const annotationImage = (id: string) => call(commands.annotationImage(id));

/**
 * Embed a mark's text so it can be found by meaning.
 *
 * Returns false when nothing needed doing — the text has not changed since it
 * was last embedded, or there is no text to embed. Recolouring a highlight
 * should not cost an inference.
 */
export const embedAnnotation = (id: string, text: string) =>
	call(commands.embedAnnotation(id, text));

/**
 * Give every mark that has none a vector, and say how many.
 *
 * Marks are embedded as they are made, and that can fail quietly — before a
 * library is open, while the model is loading. A highlight is never lost to it,
 * but the mark then cannot be found by meaning, with nothing to say so.
 */
export const embedPendingAnnotations = () => call(commands.embedPendingAnnotations());

/**
 * A mark, ranked against what the researcher is looking for: cosine similarity
 * for a search by meaning, 1 for a literal match, so never null.
 */
export type ScoredAnnotation = Annotation &
	Omit<ipc.ScoredAnnotation, keyof ipc.Annotation | 'similarity'> & { similarity: number };

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
	call(
		commands.searchAnnotations(query, options.limit ?? null, options.semantic ?? false)
	) as Promise<ScoredAnnotation[]>;
