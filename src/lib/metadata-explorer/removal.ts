import { parseCitationIds } from '$lib/citations/document';
import type { Loaded } from '$lib/manuscript/io';

/**
 * What the dialog says before a source is removed from the library
 * (M1b-4, docs/ux.md UX-4). Pure, so every sentence is tested here and the
 * component only lays them out.
 */

/** How many citations in `doc` name the work: a citation of two works counts once. */
export function citationsOf(doc: unknown, isWork: (id: string) => boolean): number {
	let count = 0;
	const walk = (node: unknown) => {
		if (typeof node !== 'object' || node === null) return;
		const { type, attrs, content } = node as {
			type?: unknown;
			attrs?: { id?: unknown };
			content?: unknown;
		};
		if (type === 'citation' && parseCitationIds(attrs?.id).some(isWork)) count++;
		if (Array.isArray(content)) content.forEach(walk);
	};
	walk(doc);
	return count;
}

export interface CitedIn {
	count: number;
	/** The titles of the manuscripts that cite it, in the project's order. */
	documents: string[];
}

/**
 * The work's citations across the project's manuscripts, read from disk.
 *
 * A manuscript that can't be read counts nothing rather than stopping the
 * dialog: it's a question about consequences, and the rest are still true.
 */
export async function citationsInProject(
	documents: readonly { title: string; path: string }[],
	load: (path: string) => Promise<Loaded>,
	isWork: (id: string) => boolean
): Promise<CitedIn> {
	const cited: CitedIn = { count: 0, documents: [] };
	for (const document of documents) {
		let loaded: Loaded;
		try {
			loaded = await load(document.path);
		} catch {
			continue;
		}
		const n = citationsOf(loaded.content, isWork);
		if (n === 0) continue;
		cited.count += n;
		cited.documents.push(document.title);
	}
	return cited;
}

/** Where the source's PDF is, as far as removing it goes. */
export type FilePlace = 'none' | 'elsewhere' | 'in-project';

/** Whether `path` is inside the project folder at `root`, which its next scan reads. */
export function filePlace(path: string | null, root: string): FilePlace {
	if (!path) return 'none';
	const folder = root.endsWith('/') ? root : `${root}/`;
	return root && path.startsWith(folder) ? 'in-project' : 'elsewhere';
}

export interface Consequences {
	/** "Cited 4 times in", then the documents, then `citedAfter`. Null when nothing cites it. */
	cited: { before: string; documents: string[]; after: string } | null;
	/** "2 notes and 11 highlights will be deleted." Null when there are none. */
	deleted: string | null;
	/** What happens to the PDF. Null for a source with no file. */
	file: string | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function removalTitle(title: string): string {
	return `Remove “${title}” from your library?`;
}

export function consequences(args: {
	cited: CitedIn;
	notes: number;
	highlights: number;
	file: FilePlace;
}): Consequences {
	const { cited, notes, highlights, file } = args;

	const parts = [
		notes ? plural(notes, 'note', 'notes') : null,
		highlights ? plural(highlights, 'highlight', 'highlights') : null
	].filter((part) => part !== null);

	return {
		cited: cited.count
			? {
					before: `Cited ${plural(cited.count, 'time', 'times')} in`,
					documents: cited.documents,
					after:
						'in this project. Those citations will show “not in your library” until you add it again.'
				}
			: null,
		deleted: parts.length ? `${parts.join(' and ')} will be deleted.` : null,
		file:
			file === 'none'
				? null
				: file === 'in-project'
					? 'The PDF stays where it is. It’s in this project’s folder, so the next time the project opens, Erti will add it again as a new source.'
					: 'The PDF itself stays where it is.'
	};
}

/** "A", "A and B", "A, B and C": what goes between the `i`th name and the next. */
export function separator(i: number, count: number): string {
	if (i === count - 1) return '';
	return i === count - 2 ? ' and ' : ', ';
}

export const REMOVED = 'Removed. You can restore it from a library backup in Settings › Library.';
