import type { FindingKind } from './classify';

/**
 * Every word the Check panel says (M4-8, docs/ux.md UX-7).
 *
 * Kept in one module so they can be read together and held to Principles 2
 * and 3: the panel states what the words match, never a verdict about the
 * writer, and says which of empty, failed and done it is. `copy.test.ts`
 * fails on the words a verdict is made of.
 */

export const TITLE = 'Check attribution';
export const RUN = 'Run check';
export const RUNNING = 'Checking…';

/** Each group's title, in words (UX-7). */
export const GROUP_TITLES: Record<FindingKind, string> = {
	uncited: 'Matches a source, no citation nearby',
	drifted_quote: 'Quoted, but the words differ from the source',
	wrong_source: 'Cited to one source, matches another',
	self_reuse: 'Reused from another document in this project'
};

/** Before the first check: what it does, since it never runs by itself. */
export const NOT_RUN = 'Check this document’s sentences against your library.';
export const NOT_RUN_DETAIL =
	'It runs only when you ask, on this computer. Nothing is sent anywhere.';

export const NO_DOCUMENT = 'Open a document to check it.';

/** Fixed copy (M4-5 AC-2): never "no problems found". */
export const NOTHING_TO_REVIEW = 'Nothing to review in the sentences checked.';
export const NOTHING_TO_REVIEW_DETAIL = 'This only covers sources in your library.';

export const TOO_SHORT = 'No sentence is long enough to compare yet.';
export const TOO_SHORT_DETAIL = 'A match needs six words in a row.';

export const FAILED = 'The check could not finish.';

export const STALE = 'The document has changed since this check.';
export const RUN_AGAIN = 'Run again';

export const DISMISSED = (n: number) => `Dismissed (${n})`;

export const ACTIONS = {
	quoteAndCite: 'Quote and cite',
	cite: 'Cite',
	blockQuote: 'Make a block quote',
	useSourceWords: 'Use the source’s words',
	showSource: 'Show source',
	showDocument: 'Show',
	dismiss: 'Dismiss',
	restore: 'Restore'
} as const;

/** What a fix said when it could not be made where the sentence is now. */
export const FIX_FAILED =
	'That sentence has changed, so the fix was not made. Run the check again.';
/** What a fix said when the sentence was as checked but the fix still wasn't made. */
export const FIX_NOT_MADE = 'That fix could not be made. The sentence is as it was.';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What the check covered (M4-5 AC-2): counts, never a percentage.
 *
 * "142 sentences checked against 23 sources in your library and 2 other
 * documents in this project."
 */
export function scopeLine(counts: { sentences: number; sources: number; documents: number }) {
	const checked = `${count(counts.sentences, 'sentence', 'sentences')} checked against ${count(
		counts.sources,
		'source',
		'sources'
	)} in your library`;
	if (counts.documents === 0) return `${checked}.`;
	return `${checked} and ${count(counts.documents, 'other document', 'other documents')} in this project.`;
}

/** The second line of a finding: the source, its page, and what differs. */
export const SAME_WORDS = 'same words';
export const SIMILAR_WORDS = 'nearly the same words';
export const SOURCE_SAYS = (words: string) => `source says “${words}”`;
export const CITED_TO = (names: string) => `cited to ${names}`;
export const PAGE = (page: string) => `p. ${page}`;
export const UNKNOWN_SOURCE = 'Unknown source';
