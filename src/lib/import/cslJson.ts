import { guardCslItem, LimitError, ShapeError } from '$lib/guard';
import { lineCounter, type ImportEntry, type Parsed, type Unreadable } from './types';

/**
 * CSL-JSON (M1b-9, ADR 009): already Erti's own shape, so reading it is the
 * shape guard's job (M1b-10). A list of items, as Zotero and citeproc write
 * it; a single item is taken as a list of one.
 */
export function parseCslJson(text: string): Parsed {
	let value: unknown;
	try {
		value = JSON.parse(text.replace(/^\uFEFF/, ''));
	} catch (error) {
		const at = error instanceof SyntaxError ? error.message.match(/position (\d+)/) : null;
		return {
			entries: [],
			unreadable: [
				{
					key: null,
					line: at ? lineCounter(text)(Number(at[1])) : null,
					reason: 'The file isn’t valid JSON.'
				}
			]
		};
	}
	const list = Array.isArray(value) ? value : [value];

	const entries: ImportEntry[] = [];
	const unreadable: Unreadable[] = [];
	list.forEach((raw, i) => {
		const position = `entry ${i + 1}`;
		try {
			const item = guardCslItem(raw);
			entries.push({ key: item.id ?? position, line: null, item, files: [] });
		} catch (error) {
			// One entry over a limit is left out, not the file.
			if (error instanceof LimitError) {
				unreadable.push({ key: position, line: null, reason: error.message });
			} else if (error instanceof ShapeError) {
				unreadable.push({ key: position, line: null, reason: 'It isn’t a source.' });
			} else {
				throw error;
			}
		}
	});
	return { entries, unreadable };
}
