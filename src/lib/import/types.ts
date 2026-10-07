import type { CslItem } from '$lib/guard';

/** One entry read from a bibliography file, as CSL-JSON (ADR 009). */
export interface ImportEntry {
	/** The entry's key in the file (BibTeX key, RIS `ID`, CSL `id`), or its position. */
	key: string;
	/** The line the entry starts on, from 1; null where the format has no lines to speak of. */
	line: number | null;
	item: CslItem;
	/** Files the entry names, as written: absolute, or relative to the bibliography. */
	files: string[];
}

/** An entry that couldn't be read, said with where it is and why (docs/ux.md UX-6). */
export interface Unreadable {
	key: string | null;
	line: number | null;
	reason: string;
}

export interface Parsed {
	entries: ImportEntry[];
	unreadable: Unreadable[];
}

/**
 * Which line an offset in `text` falls on, counted from 1.
 *
 * Asked in order, it counts on from where it last stopped: a 50,000-entry
 * file asked from the start each time would count its lines 50,000 times.
 */
export function lineCounter(text: string): (offset: number) => number {
	let at = 0;
	let line = 1;
	return (offset) => {
		if (offset < at) {
			at = 0;
			line = 1;
		}
		for (let i = text.indexOf('\n', at); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
			line++;
			at = i + 1;
		}
		return line;
	};
}
