import type {
	AttachedFile,
	ZoteroAttached,
	ZoteroCollection,
	ZoteroCreator,
	ZoteroItem,
	ZoteroLibrary,
	ZoteroPaper,
	ZoteroPick,
	ZoteroStatus
} from '$lib/ipc';

/**
 * Zotero, as `src-tauri/src/zotero` reads it (M1b-11, ADR 012), for the
 * harness and vitest. The tree, the papers and where each PDF is are data
 * here; the rules are Rust's: a folder is linked only once found or picked,
 * a collection brings everything under it, a paper is read once however it's
 * picked, PDFs are found by key, and a sync adds and never removes.
 */

/** A paper in the fake Zotero, with the collections it's directly in. */
export interface FakeZoteroPaper extends ZoteroItem {
	/** Keys of the collections it's in; none is unfiled. */
	in: string[];
}

export interface FakeZotero {
	/** Zotero's default data folder, when this computer has one. */
	detected: string | null;
	/** The folder linked, as `zotero_link` keeps it in the library. */
	linked: string | null;
	libraries: ZoteroLibrary[];
	papers: FakeZoteroPaper[];
	/** Where each stored PDF is on the fake disk, by attachment key. */
	pdfs: Record<string, string>;
	/**
	 * What the open project follows (`zotero_follow`). Rust keeps this in each
	 * project, so opening another swaps it (`fakeBackend`'s `openProject`).
	 */
	follow: ZoteroPick[];
	/** `library/key` → the work it became (`zotero_imported`), the open project's. */
	imported: Record<string, string>;
}

export const ZOTERO_DATA = '/fake/home/Zotero';
const NOT_DOWNLOADED = 'Zotero hasn’t downloaded this PDF to this computer.';

const person = (last: string, first: string, creator_type = 'author'): ZoteroCreator => ({
	creator_type,
	first_name: first,
	last_name: last,
	single: false
});

function paper(
	key: string,
	item_type: string,
	fields: Record<string, string>,
	creators: ZoteroCreator[],
	inCollections: string[],
	pdfs: { key: string; file_name: string; reason?: string }[] = []
): FakeZoteroPaper {
	return {
		library: 'user',
		key,
		item_type,
		fields: Object.entries(fields).map(([name, value]) => ({ name, base: null, value })),
		creators,
		pdfs: pdfs.map((p) => ({
			key: p.key,
			file_name: p.file_name,
			reason: p.reason ?? null,
			attached: false
		})),
		in: inCollections
	};
}

/**
 * A small library: My Library with Methods and Thesis › Chapter 2, one
 * unfiled paper, and a group. Its PDFs are served from `paperUrl`.
 */
export function defaultZotero(paperUrl: string): {
	zotero: FakeZotero;
	files: Record<string, string | { pdf: string }>;
} {
	const pdfAt = (key: string, name: string) => `${ZOTERO_DATA}/storage/${key}/${name}`;
	const pdfs = {
		ATTACHA2: pdfAt('ATTACHA2', 'putnam-2000.pdf'),
		ATTACHB3: pdfAt('ATTACHB3', 'ostrom-1990.pdf'),
		ATTACHC4: pdfAt('ATTACHC4', 'fukuyama-1995.pdf')
	};
	return {
		zotero: {
			detected: ZOTERO_DATA,
			linked: null,
			libraries: [
				{
					id: 'user',
					name: 'My Library',
					papers: 4,
					unfiled: 1,
					collections: [
						{ key: 'METHODS2', name: 'Methods', papers: 1, children: [] },
						{
							key: 'THESIS22',
							name: 'Thesis',
							papers: 1,
							children: [{ key: 'CHAPTER2', name: 'Chapter 2', papers: 1, children: [] }]
						}
					]
				},
				{
					id: 'group:4242',
					name: 'Lab reading',
					papers: 0,
					unfiled: 0,
					collections: []
				}
			],
			papers: [
				paper(
					'PAPERAA2',
					'book',
					{ title: 'Bowling Alone', date: '2000-00-00 2000', publisher: 'Simon & Schuster' },
					[person('Putnam', 'Robert D.')],
					['METHODS2'],
					[{ key: 'ATTACHA2', file_name: 'putnam-2000.pdf' }]
				),
				paper(
					'PAPERBB3',
					'book',
					{ title: 'Governing the Commons', date: '1990-00-00 1990' },
					[person('Ostrom', 'Elinor')],
					['THESIS22'],
					[{ key: 'ATTACHB3', file_name: 'ostrom-1990.pdf' }]
				),
				paper(
					'PAPERCC4',
					'journalArticle',
					{
						title: 'Social capital and civil society',
						date: '2001-03-00 March 2001',
						publicationTitle: 'Third World Quarterly'
					},
					[person('Fukuyama', 'Francis')],
					['CHAPTER2'],
					[
						{ key: 'ATTACHC4', file_name: 'fukuyama-1995.pdf' },
						{ key: 'ATTACHC5', file_name: 'fukuyama-scan.pdf', reason: NOT_DOWNLOADED }
					]
				),
				paper(
					'PAPERDD5',
					'journalArticle',
					{ title: 'Trust and the state', date: '2019-00-00 2019' },
					[person('Levi', 'Margaret'), person('Stoker', 'Laura')],
					[]
				)
			],
			pdfs,
			follow: [],
			imported: {}
		},
		files: {
			[`${ZOTERO_DATA}/zotero.sqlite`]: '',
			...Object.fromEntries(Object.values(pdfs).map((path) => [path, { pdf: paperUrl }]))
		}
	};
}

/** A failure as Rust reports it: `appError`, thrown as it is. */
type Fail = (kind: 'NotFound' | 'InvalidInput' | 'PermissionDenied', message: string) => unknown;

export function fakeZoteroCommands(
	zotero: () => FakeZotero,
	{
		granted,
		has,
		attach,
		recorded,
		known,
		addToProject,
		fail
	}: {
		granted: () => string[];
		has: (path: string) => boolean;
		attach: (work: string, path: string) => AttachedFile;
		recorded: (path: string) => boolean;
		/** Whether the library has this work, by its id or an alias. */
		known: (work: string) => boolean;
		addToProject: (work: string) => void;
		fail: Fail;
	}
) {
	const linked = () => {
		const z = zotero();
		if (!z.linked) throw fail('NotFound', 'Erti doesn’t know where Zotero keeps its library yet.');
		return z;
	};
	const status = (): ZoteroStatus => ({
		linked: zotero().linked,
		detected: zotero().detected
	});

	/** Every collection key under `key`, `key` too. */
	function under(collections: ZoteroCollection[], key: string): string[] {
		for (const c of collections) {
			if (c.key === key) {
				const all = [c.key];
				const walk = (cs: ZoteroCollection[]) =>
					cs.forEach((child) => {
						all.push(child.key);
						walk(child.children);
					});
				walk(c.children);
				return all;
			}
			const found = under(c.children, key);
			if (found.length) return found;
		}
		return [];
	}

	function picked(picks: ZoteroPick[]): FakeZoteroPaper[] {
		const z = linked();
		const seen = new Set<string>();
		const out: FakeZoteroPaper[] = [];
		for (const pick of picks) {
			const library = z.libraries.find((l) => l.id === pick.library);
			if (!library) continue;
			const keys = pick.kind === 'collection' ? under(library.collections, pick.key ?? '') : [];
			for (const p of z.papers) {
				if (p.library !== pick.library) continue;
				const matches =
					pick.kind === 'library' ||
					(pick.kind === 'unfiled' && p.in.length === 0) ||
					(pick.kind === 'collection' && p.in.some((c) => keys.includes(c))) ||
					(pick.kind === 'item' && p.key === pick.key);
				const id = `${p.library}/${p.key}`;
				if (matches && !seen.has(id)) {
					seen.add(id);
					out.push(p);
				}
			}
		}
		return out;
	}

	// The paper as Rust sends it: without the fake's own bookkeeping, and each
	// PDF saying whether the library knows it at that place already.
	const item = ({ in: _, ...rest }: FakeZoteroPaper): ZoteroItem => {
		const out = structuredClone(rest);
		const z = zotero();
		for (const pdf of out.pdfs) {
			const path = z.pdfs[pdf.key];
			pdf.attached = !pdf.reason && !!path && recorded(path);
		}
		return out;
	};

	return {
		zoteroStatus: status,
		zoteroLink(path: string | null): ZoteroStatus {
			const z = zotero();
			if (path === null) {
				if (!z.detected) throw fail('NotFound', 'Erti didn’t find Zotero on this computer.');
				z.linked = z.detected;
				return status();
			}
			if (!granted().some((g) => path === g || path.startsWith(`${g}/`))) {
				throw fail(
					'PermissionDenied',
					'Choose Zotero’s data folder with “Locate Zotero data folder…” to let Erti read it.'
				);
			}
			if (!has(`${path}/zotero.sqlite`)) {
				throw fail(
					'InvalidInput',
					'That folder has no Zotero library in it. Zotero shows its data folder under Settings › Advanced › Files and Folders.'
				);
			}
			z.linked = path;
			return status();
		},
		zoteroTree: (): ZoteroLibrary[] => structuredClone(linked().libraries),
		zoteroItems(library: string, collection: string | null): ZoteroPaper[] {
			return linked()
				.papers.filter(
					(p) =>
						p.library === library &&
						(collection === null ? p.in.length === 0 : p.in.includes(collection))
				)
				.map((p) => {
					const field = (name: string) => p.fields.find((f) => f.name === name)?.value;
					const names = p.creators.map((c) => c.last_name);
					return {
						key: p.key,
						title: field('title') ?? 'Untitled',
						creators:
							names.length > 2
								? `${names[0]} et al.`
								: names.length === 2
									? `${names[0]} & ${names[1]}`
									: (names[0] ?? ''),
						year: field('date')?.slice(0, 4) ?? null,
						pdfs: p.pdfs.length
					};
				})
				.sort((a, b) => a.title.localeCompare(b.title));
		},
		zoteroRead: (picks: ZoteroPick[]): ZoteroItem[] => picked(picks).map(item),
		zoteroAttach(pdfs: { work: string; library: string; key: string }[]): ZoteroAttached[] {
			const z = linked();
			return pdfs.map(({ work, key }) => {
				const path = z.pdfs[key];
				if (!path || !has(path)) {
					return { key, work, path: null, file: null, reason: NOT_DOWNLOADED };
				}
				try {
					return { key, work, path, file: attach(work, path), reason: null };
				} catch (error) {
					const reason = (error as { message?: string }).message ?? String(error);
					return { key, work, path, file: null, reason };
				}
			});
		},
		zoteroRecord(records: { library: string; key: string; work: string }[]) {
			const z = zotero();
			if (records.some((r) => !known(r.work))) {
				throw fail('NotFound', 'That source isn’t in your library.');
			}
			for (const r of records) {
				z.imported[`${r.library}/${r.key}`] = r.work;
				addToProject(r.work);
			}
			return null;
		},
		zoteroFollow(picks: ZoteroPick[]) {
			const z = zotero();
			for (const pick of picks) {
				const same = (p: ZoteroPick) =>
					p.library === pick.library && p.kind === pick.kind && (p.key ?? '') === (pick.key ?? '');
				const at = z.follow.findIndex(same);
				if (at >= 0) z.follow[at] = pick;
				else z.follow.push(pick);
			}
			return null;
		},
		zoteroFollowing: (): ZoteroPick[] => structuredClone(zotero().follow),
		zoteroSyncPlan() {
			const z = zotero();
			if (z.follow.length === 0) return { items: [], pdfs: [], gone: 0 };
			const current = picked(z.follow);
			const ids = new Set(current.map((p) => `${p.library}/${p.key}`));
			const items = current.filter((p) => !z.imported[`${p.library}/${p.key}`]).map(item);
			const pdfs = current.flatMap((p) => {
				const work = z.imported[`${p.library}/${p.key}`];
				if (!work) return [];
				return p.pdfs
					.filter((pdf) => !pdf.reason && z.pdfs[pdf.key] && !recorded(z.pdfs[pdf.key]))
					.map((pdf) => ({ work, library: p.library, key: pdf.key }));
			});
			const gone = Object.keys(z.imported).filter((id) => !ids.has(id)).length;
			return { items, pdfs, gone };
		}
	};
}
