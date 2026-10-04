import { parseCitationIds } from '$lib/citations/document';
import { citedIds, snapshotSources } from '$lib/manuscript/format';
import { createManuscriptSession, type Loaded, type ManuscriptFiles } from '$lib/manuscript/io';

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
	/**
	 * Manuscripts citing it under ids they carry no copy of, with those ids: a
	 * file from before 1.0, or one not saved since. Without a copy, removing it
	 * would turn their citations into errors rather than "not in your library".
	 */
	uncarried: { path: string; ids: string[] }[];
}

/** A manuscript as read for the dialog. Null when it couldn't be read. */
export interface Read {
	title: string;
	path: string;
	loaded: Loaded | null;
}

/**
 * Every manuscript, read at once rather than one after another: the dialog
 * waits on the slowest, not the sum.
 *
 * One that can't be read is null rather than stopping the dialog: it's a
 * question about consequences, and the rest are still true.
 */
export function readAll(
	documents: readonly { title: string; path: string }[],
	load: (path: string) => Promise<Loaded>
): Promise<Read[]> {
	return Promise.all(
		documents.map(async ({ title, path }) => ({
			title,
			path,
			loaded: await load(path).catch(() => null)
		}))
	);
}

/** The work's citations across the project's manuscripts. */
export function citationsIn(
	manuscripts: readonly Read[],
	isWork: (id: string) => boolean
): CitedIn {
	const cited: CitedIn = { count: 0, documents: [], uncarried: [] };
	for (const { title, path, loaded } of manuscripts) {
		if (!loaded) continue;
		const n = citationsOf(loaded.content, isWork);
		if (n === 0) continue;
		cited.count += n;
		cited.documents.push(title);
		// Only a file this Erti can write: one from a newer Erti is read-only,
		// and carries what it cites anyway.
		if (loaded.status !== 'ok') continue;
		const ids = citedIds(loaded.content).filter((id) => isWork(id) && !(id in loaded.sources));
		if (ids.length) cited.uncarried.push({ path, ids });
	}
	return cited;
}

/**
 * Give each manuscript in `uncarried` its own copy of the work, before the
 * library's goes, as a save by the editor would have (M1a-8): filed under
 * the ids it cites, and a file from before 1.0 keeping its backup.
 *
 * Throws if a file can't be written, so nothing is removed that would leave
 * its citations as errors. A file that turned unreadable since is skipped.
 */
export async function carryInto(
	uncarried: CitedIn['uncarried'],
	work: { id: string; csl: object | null },
	files: ManuscriptFiles
): Promise<void> {
	if (!work.csl) return;
	for (const { path, ids } of uncarried) {
		const session = createManuscriptSession(files);
		const loaded = await session.open(path);
		if (loaded.status !== 'ok') continue;
		const copies = snapshotSources(ids, { [work.id]: work.csl }, {}, () => work.id);
		await session.save(path, loaded.content, { ...loaded.sources, ...copies });
	}
}

/** Where the source's PDF is, as far as removing it goes. */
export type FilePlace = 'none' | 'elsewhere' | 'in-project';

/** `path` with forward slashes, no trailing one, in one case where the system ignores case. */
function comparable(path: string): string {
	const slashes = path.replace(/\\/g, '/').replace(/\/+$/, '');
	// Windows paths: a drive letter, or a share. Their case doesn't matter.
	return /^([a-z]:|\/\/)/i.test(slashes) ? slashes.toLowerCase() : slashes;
}

/**
 * Whether any of the source's files is inside the project folder at `root`,
 * which its next scan reads. Every file counts, not only the work's own: an
 * attached PDF in the folder comes back as a source of its own.
 */
export function filePlace(paths: readonly string[], root: string): FilePlace {
	if (paths.length === 0) return 'none';
	if (!root) return 'elsewhere';
	const folder = `${comparable(root)}/`;
	return paths.some((path) => comparable(path).startsWith(folder)) ? 'in-project' : 'elsewhere';
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
	cited: Pick<CitedIn, 'count' | 'documents'>;
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
