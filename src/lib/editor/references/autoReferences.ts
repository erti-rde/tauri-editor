/**
 * When a reference list should appear on its own.
 *
 * A paper with citations needs a works-cited list; leaving the author to
 * remember a toolbar button means the list is missing from exactly the drafts
 * that get sent out. So the first citation brings one with it.
 *
 * The hard part is not adding it. It is not adding it *again*: an author who
 * deletes the list — because the journal supplies its own, or because they
 * keep references in a separate file — must not watch it reappear on the next
 * keystroke. So a removal is remembered, and after one the decision is theirs
 * for the rest of the session.
 */

export interface ReferencesState {
	/** The setting. Off means never insert, whatever else is true. */
	enabled: boolean;
	/** Whether the document cites anything at all. */
	hasCitations: boolean;
	/** Whether a references list is already in the document. */
	hasBibliography: boolean;
	/** Whether this document has had one removed since it was opened. */
	dismissed: boolean;
}

/** Whether to add a references list to the document right now. */
export function shouldInsertBibliography(state: ReferencesState): boolean {
	if (!state.enabled) return false;
	// Nothing to list. An empty references heading on a document with no
	// citations is furniture rather than content.
	if (!state.hasCitations) return false;
	if (state.hasBibliography) return false;
	// Removed on purpose. Putting it back would be the app arguing.
	if (state.dismissed) return false;

	return true;
}

/**
 * Whether the author has just removed the list.
 *
 * Distinguished from "there was never one" by the previous observation: a list
 * that was present and now is not, while the document still cites something,
 * was deleted rather than never created.
 */
export function wasDismissed(
	previous: { hasBibliography: boolean },
	next: ReferencesState
): boolean {
	return previous.hasBibliography && !next.hasBibliography && next.hasCitations;
}

/**
 * Tracks one document's references list across edits.
 *
 * Stateful because "did the author delete it" is a question about history, and
 * the alternative — re-deriving it from the document — cannot tell a deletion
 * from a document that never had one.
 */
export function createReferencesWatcher() {
	let dismissed = false;
	let previous = { hasBibliography: false };

	return {
		/** Reset for a different manuscript. A dismissal belongs to its document. */
		reset() {
			dismissed = false;
			previous = { hasBibliography: false };
		},

		/**
		 * Report the document's current state; get back whether to insert a list.
		 */
		observe(state: Omit<ReferencesState, 'dismissed'>): boolean {
			if (wasDismissed(previous, { ...state, dismissed })) dismissed = true;
			previous = { hasBibliography: state.hasBibliography };

			return shouldInsertBibliography({ ...state, dismissed });
		},

		get hasDismissed() {
			return dismissed;
		}
	};
}
