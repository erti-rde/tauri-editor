import { writable } from 'svelte/store';

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { parseCitationIds } from '$lib/citations/document';

/**
 * What the writer is working on, for the panel beside them.
 *
 * The editor publishes; the notes panel reads. Same arrangement as
 * `outlineStore` and for the same reason — they are siblings in the layout, so
 * neither can reach the other.
 *
 * What crosses is the paragraph's text and nothing else. The panel has no
 * business with the document, and keeping it to a string means the search it
 * runs is the same one the citation panel runs over a selection.
 */

export interface DraftContext {
	/** The paragraph holding the cursor. Empty when there is nothing to go on. */
	paragraph: string;
	/**
	 * Insert a citation for a paper, provided by the editor while one is open.
	 *
	 * Handed over rather than re-derived, because only the editor holds the
	 * ProseMirror view — and null when no manuscript is open, so the panel can
	 * offer to cite only when there is somewhere for a citation to go.
	 */
	cite: ((sha256: string) => Promise<void>) | null;
}

const EMPTY: DraftContext = { paragraph: '', cite: null };

function createDraftContext() {
	const { subscribe, set, update } = writable<DraftContext>(EMPTY);

	return {
		subscribe,

		report(patch: Partial<DraftContext>) {
			update((state) => ({ ...state, ...patch }));
		},

		/**
		 * No manuscript open.
		 *
		 * Clears `cite` as well as the paragraph: a stale one would insert into a
		 * destroyed editor view, and the panel outlives the editor whenever
		 * someone closes a project.
		 */
		clear() {
			set(EMPTY);
		}
	};
}

export const draftContext = createDraftContext();

/**
 * How much text is worth searching on.
 *
 * Below this a paragraph is a fragment — a heading, half a sentence, the start
 * of a thought — and the matches it produces are noise that changes on every
 * keystroke. Waiting until there is a sentence is what keeps the panel still.
 */
export const MINIMUM_CONTEXT = 40;

/**
 * The paragraph the cursor is in.
 *
 * Returns an empty string when there is not enough to go on, so callers do not
 * each have to decide what counts.
 */
export function paragraphAt(doc: ProseMirrorNode, pos: number): string {
	if (pos < 0 || pos > doc.content.size) return '';

	const resolved = doc.resolve(pos);
	const text = resolved.parent.textContent.trim();

	return text.length >= MINIMUM_CONTEXT ? text : '';
}

/* ------------------------------------------------------------------ nudging */

/** A paper a note points at, and how close that note was. */
export interface DraftMatch {
	sha256: string;
	similarity: number;
}

export interface DraftMatches {
	/** The paragraph these were found for, so a stale set can be recognised. */
	paragraph: string;
	sources: DraftMatch[];
}

/**
 * What the panel found, back the other way.
 *
 * The editor cannot search and the panel cannot read the document, so the two
 * halves of "is there a note about this that I have not used" live apart: the
 * panel reports what it found, and the editor — which knows what the paragraph
 * already cites — decides whether that is worth a mark in the margin.
 */
export const draftMatches = writable<DraftMatches>({ paragraph: '', sources: [] });

/**
 * How close a note has to be before it is worth mentioning unasked.
 *
 * Set conservatively and honestly untuned: choosing this properly means
 * measuring against a real corpus of somebody's real notes, which is not
 * something that can be guessed from an empty library. Too low and the margin
 * fills with marks nobody wants; too high and the feature never appears. It is
 * a setting for that reason, and it errs towards silence.
 */
export const NUDGE_THRESHOLD = 0.55;

/**
 * Which of the papers found are worth a mark in the margin.
 *
 * A paper the paragraph already cites is not news — the writer has plainly seen
 * it — so pointing at it again is exactly the kind of nagging that gets a
 * feature switched off.
 */
export function worthNudging(
	sources: DraftMatch[],
	alreadyCited: ReadonlySet<string>,
	threshold = NUDGE_THRESHOLD
): DraftMatch[] {
	return sources.filter(
		(source) => source.similarity >= threshold && !alreadyCited.has(source.sha256)
	);
}

/**
 * Which papers a paragraph already cites.
 *
 * One citation can stand for several works — the node's `id` is a JSON array —
 * so this flattens them. It lives here rather than inside the editor component
 * so the rule it feeds can be tested against a real paragraph.
 */
export function citedSources(paragraph: ProseMirrorNode): Set<string> {
	const cited = new Set<string>();

	paragraph.descendants((node) => {
		if (node.type.name !== 'citation') return;
		for (const id of parseCitationIds(node.attrs.id)) cited.add(id);
	});

	return cited;
}
