import { dedupe, type Match, type Unreadable } from '$lib/import';
import { readZoteroItems, type CslMaps, type ZoteroEntry } from '$lib/import/zotero';
import {
	call,
	commands,
	describeError,
	type ZoteroAttach,
	type ZoteroItem,
	type ZoteroPick
} from '$lib/ipc';
import type { AugmentedZoteroSchema } from '$lib/metadata-explorer/adapterCslZotero';
import {
	BATCH,
	ImportStopped,
	known,
	toSource,
	type AttachedPdf,
	type Imported
} from '$lib/metadata-explorer/bibliography';
import { importSources, libraryWorks } from '$lib/stores/db';

/**
 * Importing from Zotero (M1b-11, ADR 012): what's ticked is read from
 * Zotero, sorted against the library for the preview before anything is
 * written (AC-5), then imported as a bibliography is, with each paper's PDF
 * attached where Zotero keeps it (AC-6). The project notes which work each
 * paper became, and what it follows, for a sync (AC-8).
 */

export interface ZoteroPreview {
	fresh: ZoteroEntry[];
	known: { entry: ZoteroEntry; match: Match }[];
	unreadable: Unreadable[];
	/** New papers' PDFs that will be attached. */
	pdfs: number;
	/** New papers' PDFs that can't be, and why. */
	unattachable: { file: string; title: string; reason: string }[];
}

/** Rust attaches at most 200 at a time (`ATTACH_BATCH`); fewer, so progress moves. */
const ATTACH_BATCH = 25;

export async function sortAgainstLibrary(
	items: ZoteroItem[],
	maps: CslMaps
): Promise<ZoteroPreview> {
	const [read, works] = await Promise.all([
		Promise.resolve(readZoteroItems(items, maps)),
		libraryWorks()
	]);
	const sorted = dedupe(works.map(known), read.entries);
	// A paper twice in what was read is one paper; the reader gives each once,
	// so `repeated` is empty here, and the first is kept if it ever isn't.
	const fresh = sorted.fresh as ZoteroEntry[];
	const attachable = fresh.flatMap((entry) => entry.pdfs.filter((pdf) => !pdf.reason));
	return {
		fresh,
		known: sorted.known as ZoteroPreview['known'],
		unreadable: read.unreadable,
		pdfs: attachable.length,
		unattachable: fresh.flatMap((entry) =>
			entry.pdfs
				.filter((pdf) => pdf.reason)
				.map((pdf) => ({
					file: pdf.file_name,
					title: String(entry.item.title ?? entry.zoteroKey),
					reason: pdf.reason ?? ''
				}))
		)
	};
}

/** What the picks stand for, read from Zotero and sorted (AC-5). */
export async function previewZotero(picks: ZoteroPick[], maps: CslMaps): Promise<ZoteroPreview> {
	return sortAgainstLibrary(await call(commands.zoteroRead(picks)), maps);
}

export type Progress = (step: 'importing' | 'attaching', done: number, total: number) => void;

/**
 * Import the new papers into the library and this project, note what each
 * became, follow the picks if asked, and attach the PDFs (AC-6, AC-8).
 * `extra` are PDFs to attach to works the project has already: a sync's.
 */
export async function importZotero(
	preview: ZoteroPreview,
	schema: AugmentedZoteroSchema,
	{
		follow = null,
		extra = [],
		onprogress = () => {}
	}: { follow?: ZoteroPick[] | null; extra?: ZoteroAttach[]; onprogress?: Progress } = {}
): Promise<Imported> {
	const imported: Imported = { added: [], skipped: 0, pdfs: [], attached: [], unattached: [] };
	const records = preview.known.map(({ entry, match }) => ({
		library: entry.library,
		key: entry.zoteroKey,
		work: match.id
	}));
	const attach: ZoteroAttach[] = [...extra];

	const sources = preview.fresh.map((entry) => toSource(entry, schema));
	for (let start = 0; start < sources.length; start += BATCH) {
		const batch = sources.slice(start, start + BATCH);
		let result;
		try {
			result = await importSources(batch, true);
		} catch (error) {
			await call(commands.zoteroRecord(records));
			throw new ImportStopped(error, imported);
		}
		const added = new Set(result.added);
		batch.forEach((source, i) => {
			if (!added.has(source.id)) return;
			const entry = preview.fresh[start + i];
			imported.added.push(source.id);
			records.push({ library: entry.library, key: entry.zoteroKey, work: source.id });
			for (const pdf of entry.pdfs) {
				if (!pdf.reason) attach.push({ work: source.id, library: entry.library, key: pdf.key });
			}
		});
		imported.skipped += result.skipped.length;
		onprogress('importing', Math.min(start + BATCH, sources.length), sources.length);
	}

	await call(commands.zoteroRecord(records));
	if (follow?.length) await call(commands.zoteroFollow(follow));

	for (let start = 0; start < attach.length; start += ATTACH_BATCH) {
		let outcomes;
		try {
			outcomes = await call(commands.zoteroAttach(attach.slice(start, start + ATTACH_BATCH)));
		} catch (error) {
			// The rest are said as one: Zotero went away, or got busy.
			for (const pdf of attach.slice(start)) {
				imported.unattached.push({ path: pdf.key, reason: describeError(error) });
			}
			break;
		}
		for (const outcome of outcomes) {
			if (outcome.file && outcome.path) {
				const pdf: AttachedPdf = {
					sha256: outcome.file.sha256,
					path: outcome.path,
					file_name: outcome.file.file_name,
					needs_ingest: outcome.file.needs_ingest
				};
				imported.attached.push(pdf);
			} else {
				imported.unattached.push({
					path: outcome.path ?? outcome.key,
					reason: outcome.reason ?? ''
				});
			}
		}
		onprogress('attaching', Math.min(start + ATTACH_BATCH, attach.length), attach.length);
	}
	return imported;
}

/** What a sync would bring, sorted as an import is (AC-8). */
export async function previewSync(
	maps: CslMaps
): Promise<{ preview: ZoteroPreview; pdfs: ZoteroAttach[]; gone: number }> {
	const plan = await call(commands.zoteroSyncPlan());
	return {
		preview: await sortAgainstLibrary(plan.items, maps),
		pdfs: plan.pdfs,
		gone: plan.gone
	};
}

/** How many papers a sync would add or give a PDF: the "3 new" in Sources. */
export const newInSync = (sync: { preview: ZoteroPreview; pdfs: ZoteroAttach[] }) =>
	sync.preview.fresh.length + sync.preview.known.length + sync.pdfs.length;

/**
 * Say what an import from Zotero did, and read the PDFs it attached in the
 * background, as a folder scan reads them (`ingestAll`). Returns once the
 * reading is under way, not done.
 */
export function announce(
	imported: Imported,
	{
		into,
		read,
		success,
		failure
	}: {
		into: string;
		read: (pdfs: { path: string; name: string; sha256: string }[]) => Promise<void>;
		success: (message: string) => void;
		failure: (message: string) => void;
	}
): Promise<void> | null {
	const count = (n: number) => n.toLocaleString('en-GB');
	const reading = imported.attached.filter((file) => file.needs_ingest);
	const sources = `${count(imported.added.length)} ${imported.added.length === 1 ? 'source' : 'sources'}`;
	const pdfs =
		imported.attached.length > 0
			? ` Attached ${count(imported.attached.length)} ${imported.attached.length === 1 ? 'PDF' : 'PDFs'} where Zotero keeps them${reading.length > 0 ? ', which Erti is reading now' : ''}.`
			: '';
	success(`Imported ${sources} from Zotero into your library and ${into}.${pdfs}`);
	if (imported.unattached.length > 0) {
		const [first] = imported.unattached;
		failure(
			imported.unattached.length === 1
				? `Could not attach a PDF: ${first.reason}`
				: `Could not attach ${count(imported.unattached.length)} PDFs. The first: ${first.reason}`
		);
	}
	if (reading.length === 0) return null;
	return read(
		reading.map((file) => ({ path: file.path, name: file.file_name, sha256: file.sha256 }))
	);
}
