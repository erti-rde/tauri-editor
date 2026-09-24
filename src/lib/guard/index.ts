/**
 * The shape guards: what untrusted data may look like once it's inside
 * (M1b-10, SEC-3, SEC-4, threats T1 and T8).
 *
 * Other people's files reach Erti from several sides: a co-author's manuscript
 * and the sources it carries, a bibliography exported from another tool, an
 * annotation sidecar, a metadata lookup's reply. Each is checked here, at the
 * boundary, so nothing downstream has to wonder:
 *
 * - **Unknown fields are dropped**, by building a fresh object from an
 *   allowlist. A key like `__proto__` is never copied, so it can't reach a
 *   prototype.
 * - **Strings, arrays and nesting are capped.** A 10⁶-entry author list or a
 *   document nested 10,000 deep is refused or cut, not handed to citeproc or
 *   ProseMirror to choke on.
 * - **Too big is refused, with a message naming the limit** (`LimitError`).
 *   Cutting a bibliography off at an arbitrary entry would lose work silently.
 *
 * Text isn't sanitised here: a `<script>` in a title stays text, and becomes
 * harmless where text becomes HTML (`citations/sanitize.ts`). Escaping it
 * twice would corrupt titles that legitimately contain `<`.
 *
 * The limits are provisional until M6-2 measures real libraries.
 *
 * Pure: no Svelte, no Tauri (ADR 001).
 */

export const LIMITS = {
	/** A manuscript file (SEC-4). */
	manuscriptBytes: 50 * 1024 * 1024,
	/** A bibliography file to import (SEC-4). */
	bibliographyBytes: 20 * 1024 * 1024,
	/** Entries in one import (SEC-4). */
	importEntries: 50_000,
	/** Sources carried in one manuscript. */
	manuscriptSources: 20_000,
	/** Marks in one sidecar. */
	sidecarMarks: 100_000,
	/** People in one name list: large collaborations run to a few thousand. */
	names: 10_000,
	/** One ordinary string field. */
	field: 10_000,
	/** A long free-text field: an abstract, a note. */
	longField: 200_000,
	/** Document nesting. Real manuscripts are a dozen deep; lists in tables in quotes, perhaps 30. */
	depth: 200,
	/** Nodes in one document. */
	nodes: 2_000_000
} as const;

/** Refused for being too big. The message says which limit, and what it is. */
export class LimitError extends Error {
	constructor(
		readonly limit: keyof typeof LIMITS,
		message: string
	) {
		super(message);
		this.name = 'LimitError';
	}
}

/** Refused for not being what it claims to be. */
export class ShapeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ShapeError';
	}
}

const count = (n: number) => n.toLocaleString('en-GB');
const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/** Refuse a file before parsing it, by its size in bytes. */
export function checkSize(bytes: number, limit: 'manuscriptBytes' | 'bibliographyBytes'): void {
	if (bytes <= LIMITS[limit]) return;
	const what = limit === 'manuscriptBytes' ? 'A manuscript' : 'A bibliography to import';
	throw new LimitError(
		limit,
		`${what} can be at most ${megabytes(LIMITS[limit])}; this one is ${megabytes(bytes)}.`
	);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A string, cut to `max` characters; numbers become text. A list gives its first
 * value: Crossref sends `ISSN`, and sometimes `title`, as a list of
 * alternatives where CSL expects one. Anything else is dropped.
 */
function text(value: unknown, max: number): string | undefined {
	if (Array.isArray(value)) return value.length > 0 ? text(value[0], max) : undefined;
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	if (typeof value !== 'string') return undefined;
	return value.length > max ? value.slice(0, max) : value;
}

/* ------------------------------------------------------------------ CSL-JSON */

/** CSL 1.0.2 item types. Anything else renders as a generic document. */
const CSL_TYPES = new Set([
	'article',
	'article-journal',
	'article-magazine',
	'article-newspaper',
	'bill',
	'book',
	'broadcast',
	'chapter',
	'classic',
	'collection',
	'dataset',
	'document',
	'entry',
	'entry-dictionary',
	'entry-encyclopedia',
	'event',
	'figure',
	'graphic',
	'hearing',
	'interview',
	'legal_case',
	'legislation',
	'manuscript',
	'map',
	'motion_picture',
	'musical_score',
	'pamphlet',
	'paper-conference',
	'patent',
	'performance',
	'periodical',
	'personal_communication',
	'post',
	'post-weblog',
	'regulation',
	'report',
	'review',
	'review-book',
	'software',
	'song',
	'speech',
	'standard',
	'thesis',
	'treaty',
	'webpage'
]);

/** CSL 1.0.2 variables holding text or numbers. */
const CSL_TEXT = new Set([
	'annote',
	'archive',
	'archive_collection',
	'archive_location',
	'archive-place',
	'authority',
	'call-number',
	'chapter-number',
	'citation-key',
	'citation-label',
	'citation-number',
	'collection-number',
	'collection-title',
	'container-title',
	'container-title-short',
	'dimensions',
	'division',
	'DOI',
	'edition',
	'event',
	'event-title',
	'event-place',
	'first-reference-note-number',
	'genre',
	'ISBN',
	'ISSN',
	'issue',
	'jurisdiction',
	'keyword',
	'language',
	'license',
	'locator',
	'medium',
	'number',
	'number-of-pages',
	'number-of-volumes',
	'original-publisher',
	'original-publisher-place',
	'original-title',
	'page',
	'page-first',
	'part-number',
	'part-title',
	'PMCID',
	'PMID',
	'printing-number',
	'publisher',
	'publisher-place',
	'references',
	'reviewed-genre',
	'reviewed-title',
	'scale',
	'section',
	'source',
	'status',
	'supplement-number',
	'title',
	'title-short',
	'URL',
	'version',
	'volume',
	'volume-title',
	'volume-title-short',
	'year-suffix',
	// Written by Zotero and older CSL, and read by the edit form.
	'shortTitle',
	'journalAbbreviation',
	// Erti's own: the Zotero type the edit form shows (adapterCslZotero).
	'zotero_type'
]);

/** Free text that is legitimately long. */
const CSL_LONG = new Set(['abstract', 'note']);

const CSL_DATES = new Set([
	'accessed',
	'available-date',
	'event-date',
	'issued',
	'original-date',
	'submitted'
]);

const CSL_NAMES = new Set([
	'author',
	'chair',
	'collection-editor',
	'compiler',
	'composer',
	'container-author',
	'contributor',
	'curator',
	'director',
	'editor',
	'editorial-director',
	'editor-translator',
	'executive-producer',
	'guest',
	'host',
	'illustrator',
	'interviewer',
	'narrator',
	'organizer',
	'original-author',
	'performer',
	'producer',
	'recipient',
	'reviewed-author',
	'script-writer',
	'series-creator',
	'translator'
]);

const NAME_PARTS = [
	'family',
	'given',
	'literal',
	'suffix',
	'dropping-particle',
	'non-dropping-particle'
] as const;

export type CslItem = Record<string, unknown> & { id?: string; type: string };

function guardName(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value)) return undefined;
	const out: Record<string, string> = {};
	for (const part of NAME_PARTS) {
		// Strings only: a number isn't anyone's name.
		const v = typeof value[part] === 'string' ? text(value[part], LIMITS.field) : undefined;
		if (v !== undefined) out[part] = v;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function guardNames(value: unknown, variable: string): Record<string, string>[] | undefined {
	if (!Array.isArray(value)) return undefined;
	if (value.length > LIMITS.names) {
		throw new LimitError(
			'names',
			`A source can list at most ${count(LIMITS.names)} people as ${variable}; this one lists ${count(value.length)}.`
		);
	}
	const names = value.map(guardName).filter((n): n is Record<string, string> => n !== undefined);
	return names.length > 0 ? names : undefined;
}

const datePart = (v: unknown) =>
	(typeof v === 'number' && Number.isInteger(v)) || (typeof v === 'string' && /^-?\d{1,4}$/.test(v))
		? Number(v)
		: undefined;

function guardDate(value: unknown): Record<string, unknown> | undefined {
	if (!isRecord(value)) return undefined;
	const out: Record<string, unknown> = {};

	const parts = value['date-parts'];
	if (Array.isArray(parts)) {
		// A date, or a range of two; each year, month, day.
		const kept = parts
			.slice(0, 2)
			.filter(Array.isArray)
			.map((part: unknown[]) => part.slice(0, 3).map(datePart))
			.filter((part) => part.length > 0 && part.every((p) => p !== undefined));
		if (kept.length > 0) out['date-parts'] = kept;
	}
	for (const key of ['literal', 'raw'] as const) {
		const v = text(value[key], LIMITS.field);
		if (v !== undefined) out[key] = v;
	}
	const season = datePart(value.season);
	if (season !== undefined) out.season = season;
	if (typeof value.circa === 'boolean' || typeof value.circa === 'number') out.circa = value.circa;
	else if (typeof value.circa === 'string') out.circa = text(value.circa, 32);

	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * One CSL-JSON item, as citeproc may safely be given it.
 *
 * Only CSL's own variables are kept, each with a value of its kind. A type CSL
 * doesn't know becomes `document`, which every style can render. Throws
 * `ShapeError` for something that isn't an item at all.
 */
export function guardCslItem(value: unknown): CslItem {
	if (!isRecord(value)) throw new ShapeError('A source must be an object.');

	const type =
		typeof value.type === 'string' && CSL_TYPES.has(value.type) ? value.type : 'document';
	const item: CslItem = { type };

	const id = text(value.id, LIMITS.field);
	if (id !== undefined) item.id = id;

	for (const [key, raw] of Object.entries(value)) {
		if (CSL_TEXT.has(key)) {
			const v = text(raw, LIMITS.field);
			if (v !== undefined) item[key] = v;
		} else if (CSL_LONG.has(key)) {
			const v = text(raw, LIMITS.longField);
			if (v !== undefined) item[key] = v;
		} else if (CSL_DATES.has(key)) {
			const v = guardDate(raw);
			if (v !== undefined) item[key] = v;
		} else if (CSL_NAMES.has(key)) {
			const v = guardNames(raw, key);
			if (v !== undefined) item[key] = v;
		}
	}
	return item;
}

/** A list of items to import. Refused whole if it's too long; an entry that isn't an item is skipped. */
export function guardCslItems(value: unknown): { items: CslItem[]; skipped: number } {
	if (!Array.isArray(value)) throw new ShapeError('A CSL-JSON file must hold a list of sources.');
	if (value.length > LIMITS.importEntries) {
		throw new LimitError(
			'importEntries',
			`Erti imports at most ${count(LIMITS.importEntries)} sources at once; this file has ${count(value.length)}.`
		);
	}
	const items: CslItem[] = [];
	let skipped = 0;
	for (const entry of value) {
		try {
			items.push(guardCslItem(entry));
		} catch (error) {
			if (error instanceof LimitError) throw error;
			skipped++;
		}
	}
	return { items, skipped };
}

/* ---------------------------------------------------------------- manuscripts */

const MARK_KEYS = ['type', 'attrs'] as const;

/**
 * A ProseMirror/TipTap document, structurally.
 *
 * Node and mark types aren't checked against the schema here: the editor
 * refuses those itself, and a guard that dropped an unknown node would lose
 * text silently. What's checked is what a schema can't: depth, size, and that
 * every part is the shape ProseMirror reads.
 */
export function guardDocument(value: unknown): Record<string, unknown> {
	let nodes = 0;

	function attrs(value: unknown, depth: number): Record<string, unknown> | undefined {
		if (!isRecord(value)) return undefined;
		const out: Record<string, unknown> = {};
		for (const [key, v] of Object.entries(value)) {
			if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
			const kept = plain(v, depth + 1);
			if (kept !== undefined) out[key] = kept;
		}
		return out;
	}

	/** An attribute value: JSON data only, depth- and size-capped. */
	function plain(value: unknown, depth: number): unknown {
		if (depth > LIMITS.depth) {
			throw new LimitError('depth', `A manuscript can nest at most ${LIMITS.depth} levels deep.`);
		}
		if (value === null || typeof value === 'boolean') return value;
		if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
		if (typeof value === 'string') return text(value, LIMITS.longField);
		if (Array.isArray(value)) return value.slice(0, LIMITS.names).map((v) => plain(v, depth + 1));
		if (isRecord(value)) return attrs(value, depth);
		return undefined;
	}

	function node(value: unknown, depth: number): Record<string, unknown> {
		if (depth > LIMITS.depth) {
			throw new LimitError('depth', `A manuscript can nest at most ${LIMITS.depth} levels deep.`);
		}
		if (++nodes > LIMITS.nodes) {
			throw new LimitError(
				'nodes',
				`A manuscript can hold at most ${count(LIMITS.nodes)} paragraphs, words and marks together.`
			);
		}
		if (!isRecord(value) || typeof value.type !== 'string') {
			throw new ShapeError('Part of this document is not a paragraph, heading or other block.');
		}

		const out: Record<string, unknown> = { type: text(value.type, 100) };
		const a = attrs(value.attrs, depth);
		if (a !== undefined) out.attrs = a;
		if (typeof value.text === 'string') out.text = value.text;
		if (Array.isArray(value.content)) out.content = value.content.map((c) => node(c, depth + 1));
		if (Array.isArray(value.marks)) {
			out.marks = value.marks.filter(isRecord).map((mark) => {
				const kept: Record<string, unknown> = {};
				for (const key of MARK_KEYS) {
					if (key === 'type' && typeof mark.type === 'string') kept.type = text(mark.type, 100);
					if (key === 'attrs') {
						const ma = attrs(mark.attrs, depth + 1);
						if (ma !== undefined) kept.attrs = ma;
					}
				}
				return kept;
			});
		}
		return out;
	}

	const doc = node(value, 0);
	if (doc.type !== 'doc') throw new ShapeError('A manuscript must be a document.');
	return doc;
}

/**
 * The format-1 envelope's `erti` block (ADR 002 amendment): the format number,
 * the version that saved it, and the sources it cites, each guarded as CSL.
 * A source that isn't one is dropped; the citation then renders as missing,
 * which is what it is.
 */
export function guardEnvelope(value: unknown): {
	format: number;
	savedWith?: string;
	sources: Record<string, CslItem>;
} {
	if (!isRecord(value)) throw new ShapeError('The manuscript’s Erti details are damaged.');
	const format =
		typeof value.format === 'number' && Number.isInteger(value.format) && value.format >= 0
			? value.format
			: 0;

	const sources: Record<string, CslItem> = {};
	if (isRecord(value.sources)) {
		const entries = Object.entries(value.sources);
		if (entries.length > LIMITS.manuscriptSources) {
			throw new LimitError(
				'manuscriptSources',
				`A manuscript can carry at most ${count(LIMITS.manuscriptSources)} sources; this one carries ${count(entries.length)}.`
			);
		}
		for (const [id, source] of entries) {
			if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue;
			try {
				sources[id] = guardCslItem(source);
			} catch (error) {
				if (error instanceof LimitError) throw error;
			}
		}
	}

	const savedWith = text(value.savedWith, 100);
	return savedWith === undefined ? { format, sources } : { format, savedWith, sources };
}

/* ------------------------------------------------------------------- sidecars */

const MARK_TEXT = [
	'id',
	'sha256',
	'kind',
	'label_id',
	'rects',
	'quote',
	'prefix',
	'suffix',
	'note',
	'style',
	'page_label',
	'origin',
	'created_at',
	'updated_at'
] as const;
const MARK_NUMBERS = ['page', 'char_start', 'char_end'] as const;
const LONG_MARK_TEXT = new Set(['rects', 'quote', 'note']);

/**
 * One mark from a sidecar. Refused without an id, a paper and a page, which a
 * mark can't be drawn without; the other fields are kept if they're the right
 * kind, and `null` otherwise.
 */
export function guardMark(value: unknown): Record<string, string | number | null> {
	if (!isRecord(value)) throw new ShapeError('A mark must be an object.');
	const mark: Record<string, string | number | null> = {};
	for (const key of MARK_TEXT) {
		mark[key] = text(value[key], LONG_MARK_TEXT.has(key) ? LIMITS.longField : LIMITS.field) ?? null;
	}
	for (const key of MARK_NUMBERS) {
		const v = value[key];
		mark[key] = typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
	}
	if (!mark.id || !mark.sha256 || mark.page === null) {
		throw new ShapeError('A mark needs an id, the paper it is on, and a page.');
	}
	return mark;
}

/** A sidecar file's contents. Refused whole if any mark is unusable, so an import never half-happens. */
export function guardSidecar(value: unknown): {
	format: 'erti-annotations';
	version: number;
	annotations: Record<string, string | number | null>[];
} {
	if (!isRecord(value) || value.format !== 'erti-annotations') {
		throw new ShapeError('This is not an Erti notes file.');
	}
	if (typeof value.version !== 'number' || !Array.isArray(value.annotations)) {
		throw new ShapeError('This Erti notes file is damaged.');
	}
	if (value.annotations.length > LIMITS.sidecarMarks) {
		throw new LimitError(
			'sidecarMarks',
			`A notes file can hold at most ${count(LIMITS.sidecarMarks)} marks; this one holds ${count(value.annotations.length)}.`
		);
	}
	return {
		format: 'erti-annotations',
		version: value.version,
		annotations: value.annotations.map(guardMark)
	};
}
