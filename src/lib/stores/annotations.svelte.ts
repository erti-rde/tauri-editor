import { get, writable } from 'svelte/store';
import { readSetting, writeSetting } from '$lib/settings';

import {
	annotationLabels,
	annotationsForSource,
	deleteAnnotation,
	embedAnnotation,
	nameLabelsAfterColours,
	saveAnnotation,
	saveLabel,
	sourceForPath,
	type Annotation,
	type AnnotationLabel,
	type NewAnnotation
} from '$lib/stores/db';
import { log } from '$lib/log';

/**
 * What has been marked on the paper being read.
 *
 * Loaded per source rather than per open file, because the library is keyed by
 * content hash: the same paper opened from a second project folder is the same
 * paper, and should already carry everything that was noticed about it the first
 * time. That is the whole reason annotations live in the library.
 */

export interface AnnotationsState {
	/** The paper whose marks these are, or null while none is open. */
	sha256: string | null;
	annotations: Annotation[];
	labels: AnnotationLabel[];
	/**
	 * The label a new highlight takes.
	 *
	 * Marking a passage has to be one action. Making the reader choose a colour
	 * every time turns a highlight into a small decision, and a small decision
	 * repeated a hundred times an afternoon is how a feature stops being used —
	 * so the last choice carries, and changing it is a separate, optional step.
	 */
	lastLabel: string | null;
	loading: boolean;
	/**
	 * What Ctrl+Z would put back, said in words.
	 *
	 * Null when there is nothing to undo. A string rather than a boolean because
	 * an undo that cannot say what it is about to change is one the reader has to
	 * try in order to find out.
	 */
	undoable: string | null;
}

const EMPTY: AnnotationsState = {
	sha256: null,
	annotations: [],
	labels: [],
	lastLabel: null,
	loading: false,
	undoable: null
};

/**
 * One reversal, and what to call it.
 *
 * Inverses rather than snapshots. A snapshot of every annotation on a paper,
 * kept per step, would be most of the library in memory for a feature used a few
 * times an hour — and marks are written straight through to SQLite, so a
 * snapshot restored would still have to be replayed row by row. The inverse of
 * "created" is "delete"; of "deleted" and of every edit, "save what it was".
 */
interface Reversal {
	describe: string;
	run: () => Promise<void>;
}

/**
 * How far back Ctrl+Z reaches.
 *
 * Deep enough to cover a wrong turn — a handful of marks made with the wrong
 * label, an adjust that went astray — and shallow enough that the stack is never
 * something to think about. Undo is not a version history, and treating it as
 * one invites the reader to trust it as one.
 */
const UNDO_DEPTH = 30;

function createAnnotationsStore() {
	const { subscribe, set, update } = writable<AnnotationsState>(EMPTY);

	/** Kept so writes do not have to read the store back to find the source. */
	let current: string | null = null;

	/** What Ctrl+Z would undo, most recent last. */
	let reversals: Reversal[] = [];

	function remember(reversal: Reversal) {
		reversals = [...reversals, reversal].slice(-UNDO_DEPTH);
		update((state) => ({ ...state, undoable: reversal.describe }));
	}

	function forget() {
		reversals = [];
		update((state) => ({ ...state, undoable: null }));
	}

	/** The record as it stands, so its restoration can be the inverse of a change. */
	function asWritten(annotation: Annotation): NewAnnotation {
		return {
			id: annotation.id,
			sha256: annotation.sha256,
			kind: annotation.kind,
			label_id: annotation.label_id,
			page: annotation.page,
			rects: annotation.rects,
			quote: annotation.quote,
			prefix: annotation.prefix,
			suffix: annotation.suffix,
			char_start: annotation.char_start,
			char_end: annotation.char_end,
			note: annotation.note,
			style: annotation.style,
			page_label: annotation.page_label,
			origin: annotation.origin
		};
	}

	async function readLastLabel(): Promise<string | null> {
		try {
			return await readSetting('lastAnnotationLabel');
		} catch {
			// A missing or unreadable settings file is not a reason to refuse to
			// highlight; the first label will do.
			return null;
		}
	}

	return {
		subscribe,

		/**
		 * Load the labels, for the whole session.
		 *
		 * Failing here is ordinary rather than exceptional: before a project has
		 * been opened there is no library to ask, and the settings pane and the
		 * reader both call this on mount. So it reports and leaves the labels as
		 * they were, rather than throwing into whichever component happened to be
		 * mounting at the time.
		 */
		async loadLabels() {
			try {
				const [loaded, lastLabel] = await Promise.all([annotationLabels(), readLastLabel()]);
				const labels = Array.isArray(loaded) ? loaded : [];

				update((state) => ({
					...state,
					labels,
					lastLabel: lastLabel ?? state.lastLabel ?? labels.find((l) => l.enabled)?.id ?? null
				}));
			} catch (failure) {
				log.error('Could not load the highlight labels', failure);
			}
		},

		/**
		 * Show the marks on a paper, found from the file on screen.
		 *
		 * The reader knows a path; the library knows a hash. A path Erti has never
		 * ingested is an ordinary case — a PDF dropped in a folder and opened
		 * before the scan reached it — and it simply has no marks yet.
		 */
		async openPath(path: string) {
			// A different paper is a different history. Undoing into a paper that is
			// no longer on screen would change something nobody can see.
			forget();
			update((state) => ({ ...state, loading: true }));

			try {
				// Unconditionally, and before anything else. The labels are what the
				// highlight menu is made of, and they were previously loaded only on
				// the branch for a paper the library had never seen — so for every
				// paper it had, the menu came up with no colours at all and
				// highlighting fell back to a hardcoded yellow.
				await this.loadLabels();

				const sha256 = await sourceForPath(path);
				current = sha256;

				if (!sha256) {
					update((state) => ({ ...state, sha256: null, annotations: [], loading: false }));
					return;
				}

				const loaded = await annotationsForSource(sha256);
				const annotations = Array.isArray(loaded) ? loaded : [];
				update((state) => ({ ...state, sha256, annotations, loading: false }));
			} catch (failure) {
				log.error('Could not load the annotations for this paper', failure);
				update((state) => ({ ...state, loading: false }));
			}
		},

		/**
		 * Save a mark and show it, without waiting for a reload.
		 *
		 * `describe` is what Ctrl+Z will say it is putting back. Passing nothing
		 * records no reversal, which is what an undo itself does — otherwise the
		 * first Ctrl+Z would arm a second one that redid the thing just undone.
		 */
		async save(annotation: NewAnnotation, describe?: string) {
			const before = get({ subscribe }).annotations.find((a) => a.id === annotation.id);

			if (describe) {
				// An upsert, so the inverse depends on whether this row existed. A
				// mark that did not is undone by removing it; one that did is undone
				// by writing back exactly what it was.
				remember(
					before
						? { describe, run: () => this.save(asWritten(before)) }
						: { describe, run: () => this.remove(annotation.id) }
				);
			}

			await saveAnnotation(annotation);

			if (annotation.label_id) {
				update((state) => ({ ...state, lastLabel: annotation.label_id ?? state.lastLabel }));
				try {
					await writeSetting('lastAnnotationLabel', annotation.label_id);
				} catch (failure) {
					// Losing the remembered colour is a small thing; failing the
					// highlight over it is not.
					log.error('Could not remember the last label', failure);
				}
			}

			// Embedded on write, so a note can be found by meaning the moment it
			// exists rather than after some later sweep. Deliberately not awaited
			// before the mark appears: inference takes a beat, and a highlight that
			// lags behind the selection feels broken.
			//
			// Wrapped rather than chained off the call, so a failure to embed can
			// never take the highlight with it — including a synchronous throw,
			// which `.catch` on the returned value would miss entirely.
			void (async () => {
				try {
					await embedAnnotation(
						annotation.id,
						[annotation.quote, annotation.note].filter(Boolean).join(' — ')
					);
				} catch (failure) {
					log.error('Could not embed that mark', failure);
				}
			})();

			if (!current) return;
			const loaded = await annotationsForSource(current);
			update((state) => ({ ...state, annotations: Array.isArray(loaded) ? loaded : [] }));
		},

		/**
		 * Change something about a mark that already exists.
		 *
		 * Goes through the same upsert as a new one, so an edit keeps the mark's
		 * id and its created_at — which is what makes "the first thing I noticed
		 * in this paper" mean anything.
		 */
		async update(annotation: Annotation, patch: Partial<NewAnnotation>, describe?: string) {
			await this.save({ ...asWritten(annotation), ...patch }, describe);
		},

		/**
		 * Choose the colour the next mark takes.
		 *
		 * Remembered the same way choosing one while highlighting is, so picking
		 * from the toolbar and picking from the selection popup mean the same
		 * thing rather than two settings that disagree.
		 */
		chooseLabel(labelId: string) {
			update((state) => ({ ...state, lastLabel: labelId }));
			void (async () => {
				try {
					await writeSetting('lastAnnotationLabel', labelId);
				} catch (failure) {
					log.error('Could not remember the last label', failure);
				}
			})();
		},

		/**
		 * Give every label the name of the colour it is.
		 *
		 * Offered next to the names themselves rather than only in Settings,
		 * because the moment a reader decides they do not want Erti's vocabulary
		 * is the moment they are looking at it.
		 */
		async useColourNames() {
			try {
				await nameLabelsAfterColours();
				await this.loadLabels();
			} catch (failure) {
				log.error('Could not rename the labels after their colours', failure);
			}
		},

		/** Rename a label from wherever it is being read. */
		async rename(label: AnnotationLabel, name: string) {
			try {
				await saveLabel({ ...label, name });
				await this.loadLabels();
			} catch (failure) {
				log.error('Could not rename that label', failure);
			}
		},

		async remove(id: string, describe?: string) {
			if (describe) {
				const before = get({ subscribe }).annotations.find((a) => a.id === id);
				// A mark that is not there cannot be put back, and pretending
				// otherwise would arm an undo that silently does nothing.
				if (before) remember({ describe, run: () => this.save(asWritten(before)) });
			}

			await deleteAnnotation(id);
			update((state) => ({
				...state,
				annotations: state.annotations.filter((a) => a.id !== id)
			}));
		},

		/**
		 * Put the last change back.
		 *
		 * Returns what it undid, or null when there was nothing — the caller says
		 * so, because only the caller knows where the reader is looking.
		 *
		 * There is no redo. Undo here is for the wrong turn you notice at once,
		 * and a redo stack invites treating it as a history it is not: these rows
		 * are shared by every project that opens the paper, and an edit made in
		 * another pane has no place on this stack.
		 */
		async undo(): Promise<string | null> {
			const last = reversals.at(-1);
			if (!last) return null;

			reversals = reversals.slice(0, -1);
			update((state) => ({ ...state, undoable: reversals.at(-1)?.describe ?? null }));

			await last.run();
			return last.describe;
		},

		/** No paper open. */
		clear() {
			current = null;
			forget();
			update((state) => ({ ...EMPTY, labels: state.labels, lastLabel: state.lastLabel }));
		},

		reset() {
			current = null;
			reversals = [];
			set(EMPTY);
		}
	};
}

export const annotationsStore = createAnnotationsStore();

/** The colour to draw a mark in, falling back to a neutral for an unlabelled one. */
export function colourFor(labels: AnnotationLabel[], labelId: string | null): string {
	return labels.find((label) => label.id === labelId)?.colour ?? '45 90% 60%';
}

/**
 * The page number to show, and to cite.
 *
 * The printed one when the paper has told us what it is, and the sheet
 * otherwise. Everywhere a page is put in front of the reader goes through this,
 * because a citation that says "p. 11" for an article beginning on page 843
 * points at nothing anyone can look up.
 */
export function pageLabelOf(mark: { page: number; page_label?: string | null }): string {
	return mark.page_label?.trim() || String(mark.page);
}
