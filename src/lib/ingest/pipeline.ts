/**
 * The two ingest decisions that keep getting made wrongly.
 *
 * `pdf_handlers.ts` cannot be unit tested: it imports the Tauri IPC layer, the
 * filesystem plugin and pdf.js at module scope. Every defect found in review so
 * far has been in its orchestration rather than in the extraction, chunking or
 * resolution modules underneath — which are the ones that have tests. Four in
 * the last review alone, all of them the same shape: state written before the
 * work it claims to represent, or a work set chosen from the wrong signal.
 *
 * So the decisions live here, with their side effects injected, and the module
 * above supplies the real ones. The point is not layering for its own sake; it
 * is that these two functions are where the bugs were, and now they can fail a
 * test instead of a user's library.
 */

import type { Chunk } from './chunk';
import type { ResolvedVia } from './resolve';
import { guardCslItem } from '$lib/guard';

/** A file the scan found, reduced to what the decision needs. */
export interface ScannedFile {
	path: string;
	name: string;
}

export interface SelectionDeps<T extends ScannedFile> {
	/** Content hash: a source's identity, so renames and copies collapse to one. */
	hashFile: (path: string) => Promise<string>;
	/** Registers the file and reports whether the *source row* was new. */
	registerSource: (sha256: string, path: string, fileName: string) => Promise<boolean>;
	/** Sources the library records as pending or failed. */
	unfinished: ReadonlySet<string>;
	onError?: (file: T, message: string) => void;
}

/**
 * Choose which of the scanned files to ingest.
 *
 * What decides this is the source's recorded ingest state, not whether
 * registration created the row. Selecting on "the row was new" is the old
 * filename deduplication wearing a hash: a source that failed once, or was
 * interrupted part-way, registers as not-new on every later scan and is never
 * attempted again — which is the defect the ingest-status table exists to
 * remove, and which left 41% of a real corpus permanently unprocessed.
 */
export async function selectSourcesToIngest<T extends ScannedFile>(
	files: readonly T[],
	deps: SelectionDeps<T>
): Promise<Array<T & { sha256: string }>> {
	const selected: Array<T & { sha256: string }> = [];
	const queued = new Set<string>();

	for (const file of files) {
		try {
			const sha256 = await deps.hashFile(file.path);
			const isNew = await deps.registerSource(sha256, file.path, file.name);

			// One paper can sit in a folder twice under two names. It is one source,
			// so it is embedded once.
			if ((isNew || deps.unfinished.has(sha256)) && !queued.has(sha256)) {
				queued.add(sha256);
				selected.push({ ...file, sha256 });
			}
		} catch (error) {
			// One unreadable file must not abandon the rest of the folder.
			deps.onError?.(file, error instanceof Error ? error.message : String(error));
		}
	}

	return selected;
}

export interface ResolvedForStorage {
	metadata: Record<string, unknown>;
	via: ResolvedVia;
	doi: string | null;
}

export interface CommitDeps {
	setSourceMetadata: (args: {
		sha256: string;
		cslJson: string;
		zoteroType: string | null;
		doi: string | null;
		resolvedVia: ResolvedVia;
	}) => Promise<void>;
	storeChunks: (
		sha256: string,
		chunks: Array<{
			text: string;
			embedding: number[];
			page_start: number;
			page_end: number;
			section: string | null;
			char_start: number;
			char_end: number;
		}>
	) => Promise<void>;
	markLegacyConsumed: (fileName: string) => Promise<void>;
}

/**
 * Write one ingested source, in the only order that is safe to interrupt.
 *
 * `storeChunks` is what flips the source to ready, so it goes last: ready has
 * to mean finished. Written the other way round, a failure in between left a
 * ready source with no metadata — which no scan ever offers again, and which
 * the user sees as a paper that simply cannot be cited.
 *
 * The salvaged row is consumed last for the same reason. Consuming it while
 * resolving discarded it on any later failure, so the retry found nothing to
 * carry forward and destroyed exactly the metadata the salvage migration
 * exists to preserve.
 */
export async function commitIngest(
	sha256: string,
	fileName: string,
	chunks: readonly Chunk[],
	embeddings: readonly number[][],
	resolved: ResolvedForStorage | undefined,
	deps: CommitDeps
): Promise<void> {
	// The two are zipped by index below, so a mismatch would pair one chunk's
	// text with another chunk's page and section.
	if (embeddings.length !== chunks.length) {
		throw new Error(`Embedding returned ${embeddings.length} vectors for ${chunks.length} chunks.`);
	}

	if (resolved) {
		await deps.setSourceMetadata({
			sha256,
			// A lookup's reply is someone else's data: only CSL's own fields, of
			// the right kinds and sizes, are kept (M1b-10).
			cslJson: JSON.stringify(guardCslItem(resolved.metadata)),
			zoteroType: (resolved.metadata.zotero_type as string) ?? null,
			doi: resolved.doi,
			resolvedVia: resolved.via
		});

		if (resolved.via === 'legacy') {
			await deps.markLegacyConsumed(fileName);
		}
	}

	// Page, section and offsets travel with the chunk, so a result can say
	// "p. 4, Results" and later jump to the passage in the PDF (#37).
	await deps.storeChunks(
		sha256,
		chunks.map((chunk, i) => ({
			text: chunk.text,
			embedding: embeddings[i],
			page_start: chunk.pageStart,
			page_end: chunk.pageEnd,
			section: chunk.section,
			char_start: chunk.charStart,
			char_end: chunk.charEnd
		}))
	);
}
