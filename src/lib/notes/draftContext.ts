import { writable } from 'svelte/store';

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { parseCitationIds } from '$lib/citations/document';
import type { NudgeState } from '$lib/editor/extensions/NoteNudge';
import type { NoteHit } from '$lib/stores/db';

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
	 * The works that paragraph already cites, by canonical id (ADR 003), so the
	 * panel can say "cited here" and put those last (M3-1 AC-4).
	 */
	cited: string[];
	/**
	 * Insert a citation for a paper, provided by the editor while one is open.
	 *
	 * Handed over rather than re-derived, because only the editor holds the
	 * ProseMirror view — and null when no manuscript is open, so the panel can
	 * offer to cite only when there is somewhere for a citation to go.
	 * `locator` is the page cited, as printed (M1b-8).
	 */
	cite: ((sha256: string, locator?: string) => Promise<void>) | null;
}

const EMPTY: DraftContext = { paragraph: '', cited: [], cite: null };

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

/* ---------------------------------------------------------------- following */

/**
 * How long the writer pauses before the panel looks again (M3-1 AC-3).
 *
 * Long enough that a sentence is finished rather than half typed, and short
 * enough that the notes are there by the time the writer looks across.
 */
export const FOLLOW_IDLE_MS = 600;

/** A paragraph to follow: its words and what it already cites. */
export type Followed = Pick<DraftContext, 'paragraph' | 'cited'>;

/**
 * When to tell the panel what is being written (M3-1 AC-3).
 *
 * Not per keystroke: each publish costs the panel an embedding and a search,
 * and results that change while a sentence is still being made are noise. So
 * the panel hears of a paragraph when the cursor leaves the one it was in, at
 * once, and otherwise after a pause in the same one.
 *
 * `update` is called on every transaction, edits and cursor moves alike.
 * `canonical` names a cited work by its canonical id, as search results do.
 */
export function createFollower(
	publish: (followed: Followed) => void,
	idleMs: number = FOLLOW_IDLE_MS
) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	/** Where the paragraph the cursor was last in starts, or null before the first. */
	let at: number | null = null;
	/**
	 * Where the cursor was last, to read that paragraph if it's needed. The
	 * document is kept, not its text: it's immutable, so this is still that
	 * paragraph as it was, and a keystroke costs one lookup. Nothing is read
	 * until there's something to publish.
	 */
	let last: { doc: ProseMirrorNode; pos: number } | null = null;

	function read(doc: ProseMirrorNode, pos: number, canonical: (id: string) => string): Followed {
		return {
			paragraph: paragraphAt(doc, pos),
			cited: [...new Set([...citedSources(doc.resolve(pos).parent)].map(canonical))]
		};
	}

	return {
		update(doc: ProseMirrorNode, pos: number, canonical: (id: string) => string = (id) => id) {
			clearTimeout(timer);
			if (pos < 0 || pos > doc.content.size) return;

			const start = doc.resolve(pos).start();
			const left = last;
			last = { doc, pos };

			if (start !== at) {
				// Arrived in a paragraph, or left one. A new one too short to search
				// on, as Enter leaves, isn't what's being written about: the one just
				// finished is, and it may never have paused long enough to be heard.
				at = start;
				const here = read(doc, pos, canonical);
				const now = here.paragraph || !left ? here : read(left.doc, left.pos, canonical);
				if (now.paragraph) publish(now);
				return;
			}

			timer = setTimeout(() => {
				const here = read(doc, pos, canonical);
				if (here.paragraph) publish(here);
			}, idleMs);
		},

		/** The editor is going: nothing more to say. */
		stop() {
			clearTimeout(timer);
		}
	};
}

/**
 * The first few words of a paragraph, to say what the panel is following:
 * "Related to: _Sequence models built on…_" (M3-1 AC-1).
 */
export function firstWords(paragraph: string, count = 5): string {
	const words = paragraph.trim().split(/\s+/).filter(Boolean);
	return words.length > count ? `${words.slice(0, count).join(' ')}…` : words.join(' ');
}

/* ------------------------------------------------------------------ nudging */

/** A paper a note points at, and how close that note was. */
export interface DraftMatch {
	/** The work, by its canonical id (ADR 003). */
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
 * What the panel reports from the notes it found: each by its work, which is
 * what the paragraph's citations resolve to. Marks and source notes alike
 * (M3-3): a note on a book is as much a note as a highlight in a PDF.
 */
export function matchesFrom(paragraph: string, notes: NoteHit[]): DraftMatches {
	return {
		paragraph,
		sources: notes.map(({ hit }) => ({ sha256: hit.source_id, similarity: hit.similarity }))
	};
}

/**
 * The mark the margin should show for the paragraph at `pos`: one ring at most,
 * at the paragraph's start, counting the notes worth mentioning (M3-3 AC-1).
 *
 * Nothing when the matches were found for other words, which is how a set left
 * over from the paragraph the cursor just left is recognised.
 */
export function nudgeFor(
	doc: ProseMirrorNode,
	pos: number,
	matches: DraftMatches,
	canonical: (id: string) => string
): NudgeState {
	const resolved = doc.resolve(pos);
	const paragraph = resolved.parent;
	if (paragraph.textContent.trim() !== matches.paragraph) return { pos: null, count: 0 };

	const cited = new Set([...citedSources(paragraph)].map(canonical));
	const worth = worthNudging(matches.sources, cited);
	return {
		pos: worth.length > 0 ? resolved.before(resolved.depth) : null,
		count: worth.length
	};
}

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
 * How close a result has to be to show at all while following (M3-5).
 *
 * The index always answers with its nearest rows, however far they are, so
 * without a floor "nothing is close to this paragraph" could never be said:
 * a paragraph about pruning roses would list the nearest notes on attention.
 * Measured on the retrieval eval set (`tests/fixtures/retrieval`) with
 * twelve paragraphs on unrelated subjects added:
 *
 * - notes: an unrelated paragraph's nearest note scored at most 0.25, and a
 *   paragraph's nearest note on its subject at least 0.33;
 * - passages: an unrelated paragraph's nearest passage scored at most 0.40,
 *   a paragraph's nearest related one at least 0.57.
 *
 * Apart, because a short note doesn't score comparably against a long
 * passage. Each sits between the two, nearer the unrelated side: leaving out
 * a note the writer wanted is worse than listing one they didn't. Lower than
 * the nudge's bar, which decides what to mention unasked; this decides what's
 * worth listing when the writer looks.
 */
export const SHOWN_FLOOR = { note: 0.3, passage: 0.45 } as const;

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
