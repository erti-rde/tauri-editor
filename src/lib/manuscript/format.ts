import { parseCitationIds } from '$lib/citations/document';
import { guardCslItem, guardDocument, guardEnvelope, type CslItem } from '$lib/guard';

/**
 * The manuscript file format (ADR 002 as amended, M1a-8).
 *
 * A manuscript is the document at the root, as it always was, with Erti's own
 * details beside it:
 *
 *     { "type": "doc", "content": [...],
 *       "erti": { "format": 1, "sources": { "<id>": {CSL-JSON} }, "savedWith": "1.0.0" } }
 *
 * The document stays at the root because every Erti already installed reads a
 * file with `setContent(JSON.parse(file))`. Anything else there would load as
 * nothing, and the next autosave would write that nothing over the file. Older
 * builds read `type` and `content` and ignore `erti`, so they keep every word
 * and lose only the sources, which the next save from a newer Erti puts back.
 *
 * `sources` is a snapshot of every source the document cites, so a co-author
 * without the same PDFs still sees real citations. This is the one format that
 * can't change after 1.0: add fields, never repurpose them.
 *
 * Pure: no Svelte, no Tauri (ADR 001).
 */

/** The format this build writes, and the newest it can edit. */
export const FORMAT = 1;

export interface Manuscript {
	/** The document, as ProseMirror reads it. */
	doc: Record<string, unknown>;
	/** 0 for a file with no `erti` block: everything written before 1.0. */
	format: number;
	/** The sources the file carries, each already checked as CSL. */
	sources: Record<string, CslItem>;
	savedWith?: string;
	/** Written by a newer Erti: open it, but never save over it. */
	newer: boolean;
}

/**
 * A parsed file as a manuscript. Throws the guard's `ShapeError` or
 * `LimitError` for something that isn't one, or is hostile: the caller
 * treats that as unreadable and never saves over it.
 */
export function readManuscript(parsed: unknown): Manuscript {
	const { erti, ...rest } =
		typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
	// Checked structurally: depth, size and shape. Unknown keys beside the
	// document are dropped, so they don't ride along into the next save.
	const doc = guardDocument(rest);
	const envelope = erti === undefined ? { format: 0, sources: {} } : guardEnvelope(erti);

	return {
		doc,
		format: envelope.format,
		sources: envelope.sources,
		...('savedWith' in envelope && envelope.savedWith ? { savedWith: envelope.savedWith } : {}),
		newer: envelope.format > FORMAT
	};
}

/** A document and its sources, as the file is written. */
export function writeManuscript(
	doc: Record<string, unknown>,
	sources: Record<string, CslItem>,
	savedWith: string
): Record<string, unknown> {
	// The editor's JSON never carries `erti`; this makes sure a stale one can't.
	const { erti: _, ...body } = doc;
	return { ...body, erti: { format: FORMAT, sources, savedWith } };
}

/** Every source id the document cites, in order, once each. */
export function citedIds(doc: unknown): string[] {
	const ids = new Set<string>();
	const walk = (node: unknown) => {
		if (typeof node !== 'object' || node === null) return;
		const { type, attrs, content } = node as {
			type?: unknown;
			attrs?: { id?: unknown };
			content?: unknown;
		};
		if (type === 'citation') for (const id of parseCitationIds(attrs?.id)) ids.add(id);
		if (Array.isArray(content)) content.forEach(walk);
	};
	walk(doc);
	return [...ids];
}

/**
 * The sources to save with the document: one for each cited id.
 *
 * The library's copy wins, since that's where corrections are made. A source
 * the library doesn't have keeps the snapshot the file arrived with, so a
 * co-author's citations survive being saved by someone without the paper.
 * An id neither knows is left out, and renders as missing, which it is.
 */
export function snapshotSources(
	ids: readonly string[],
	library: Record<string, unknown>,
	carried: Record<string, CslItem>
): Record<string, CslItem> {
	const sources: Record<string, CslItem> = {};
	for (const id of ids) {
		const from = library[id] ?? carried[id];
		if (from === undefined) continue;
		try {
			// `id` is set to the key, so a snapshot can't claim to be another source.
			sources[id] = { ...guardCslItem(from), id };
		} catch {
			// Not a source any more; it renders as missing rather than breaking the save.
		}
	}
	return sources;
}
