import type {
	commands,
	Annotation,
	AnnotationLabel,
	AppError,
	ErrorKind,
	NewChunk,
	ScoredAnnotation,
	ScoredChunk,
	Source
} from '$lib/ipc';

import type { Fixture } from './fixture';

/**
 * Erti's Rust side, in memory (M1a-1).
 *
 * One handler per generated command, typed from the bindings (ADR 011): a
 * command added or changed in Rust stops this file compiling until the fake
 * agrees with it. That is the point — a fake that drifts from the real thing
 * tests an app nobody runs.
 *
 * It behaves like the database rather than returning canned answers: saving a
 * mark and then listing marks returns it, a failed source is offered for ingest
 * again, and a project only sees its own sources. Anything it is asked that it
 * doesn't implement throws rather than answering `null`, because a quiet `null`
 * is how the spike hid which commands it had never heard of.
 */

type Commands = typeof commands;
type MaybePromise<T> = T | Promise<T>;

/** What a generated command resolves to on success. */
type Data<R> =
	Awaited<R> extends { status: 'ok'; data: infer T } | { status: 'error'; error: unknown }
		? T
		: Awaited<R>;

export type FakeCommands = {
	[K in keyof Commands]: (
		...args: Parameters<Commands[K]>
	) => MaybePromise<Data<ReturnType<Commands[K]>>>;
};

/**
 * A failure as Rust reports it. Thrown as a plain object, not an `Error`: the
 * generated wrapper only turns non-`Error` rejections into `{ status: 'error' }`,
 * exactly as it does for a real `AppError`.
 */
export function appError(kind: ErrorKind, message: string): AppError {
	return { kind, message };
}

/** A deterministic stand-in for SHA-256, for files the fixture didn't name. */
export function fakeHash(text: string): string {
	let h = 0x811c9dc5;
	let out = '';
	for (let round = 0; out.length < 64; round++) {
		for (let i = 0; i < text.length; i++) {
			h ^= text.charCodeAt(i) + round;
			h = Math.imul(h, 0x01000193) >>> 0;
		}
		out += h.toString(16).padStart(8, '0');
	}
	return out.slice(0, 64);
}

/** Words, for a similarity that ranks the way a person would expect. */
function words(text: string): Set<string> {
	return new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
}

/** Share of the query's words found in the text: 0 to 1, like cosine here. */
export function overlap(query: string, text: string): number {
	const q = words(query);
	if (q.size === 0) return 0;
	const t = words(text);
	let hits = 0;
	for (const w of q) if (t.has(w)) hits++;
	return hits / q.size;
}

/** A vector with the model's dimensions, stable for the same text. */
function vector(text: string): number[] {
	const seed = fakeHash(text);
	return Array.from({ length: 384 }, (_, i) => (parseInt(seed[i % 64], 16) - 7.5) / 7.5);
}

const now = () => new Date().toISOString();

export interface FakeState {
	root: string | null;
	libraryOpen: boolean;
	/** Every source the library knows, by hash. */
	library: Map<string, Source>;
	/** The open project's sources. */
	project: Set<string>;
	/** Project-local metadata corrections. */
	overrides: Map<string, string>;
	chunks: Map<string, NewChunk[]>;
	marks: Map<string, Annotation>;
	/** Marks with a vector, and the text it was made from. */
	embedded: Map<string, string>;
	labels: AnnotationLabel[];
	images: Map<string, number[]>;
	positions: Map<string, number>;
	embeddingMeta: { model_id: string; dims: number } | null;
}

export function stateFrom(fixture: Fixture): FakeState {
	const library = new Map(fixture.sources.map((s) => [s.sha256, structuredClone(s)]));
	return {
		root: null,
		libraryOpen: false,
		library,
		project: new Set(library.keys()),
		overrides: new Map(),
		// Each ready source can be found by its own title and its marked passages,
		// which is enough for the suggestions panel to have something to show.
		chunks: new Map(
			fixture.sources
				.filter((s) => s.state === 'ready')
				.map((s) => [
					s.sha256,
					[
						{ text: JSON.parse(s.csl_json ?? '{}').title ?? s.file_name, embedding: [] },
						...fixture.marks
							.filter((m) => m.sha256 === s.sha256 && m.quote)
							.map((m) => ({ text: m.quote!, embedding: [], page_start: m.page }))
					]
				])
		),
		marks: new Map(fixture.marks.map((m) => [m.id, structuredClone(m)])),
		embedded: new Map(fixture.marks.map((m) => [m.id, `${m.quote ?? ''}\n${m.note ?? ''}`])),
		labels: structuredClone(fixture.labels),
		images: new Map(),
		positions: new Map(),
		embeddingMeta: { model_id: 'all-MiniLM-L6-v2', dims: 384 }
	};
}

/** Where fixture files come from, so `read_directory` and the fs plugin agree. */
export interface Disk {
	list(): string[];
	has(path: string): boolean;
	/** The URL a PDF is served from, when the path is one. */
	pdfUrl(path: string): string | undefined;
}

const NOT_OPEN_LIBRARY = appError('Conflict', "The library isn't open yet.");
const NOT_OPEN_PROJECT = appError('Conflict', 'No project is open.');

export function fakeCommands(state: FakeState, disk: Disk): FakeCommands {
	const library = () => {
		if (!state.libraryOpen) throw NOT_OPEN_LIBRARY;
		return state.library;
	};
	const root = () => {
		library();
		if (state.root === null) throw NOT_OPEN_PROJECT;
		return state.root;
	};
	const effective = (s: Source): Source => ({
		...s,
		csl_json: state.overrides.get(s.sha256) ?? s.csl_json
	});
	const newestFirst = () =>
		[...state.marks.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
	// Project first, then by score: the order both Rust searches use.
	const projectFirst = <T extends { in_project: boolean; similarity: number | null }>(a: T, b: T) =>
		Number(b.in_project) - Number(a.in_project) || (b.similarity ?? 0) - (a.similarity ?? 0);
	const fileName = (sha: string) => state.library.get(sha)?.file_name ?? null;
	const scored = (m: Annotation, similarity: number): ScoredAnnotation => ({
		...m,
		similarity,
		in_project: state.project.has(m.sha256),
		file_name: fileName(m.sha256)
	});
	const notFound = (path: string) => appError('NotFound', `${path} doesn't exist any more.`);

	return {
		readDirectory(path) {
			const prefix = path.endsWith('/') ? path : `${path}/`;
			if (!disk.has(path)) throw notFound(path);
			// Hidden entries are skipped, as Rust skips them: `.erti` holds the
			// project database and is not something to show as a file.
			const below = disk.list().filter(
				(p) =>
					p.startsWith(prefix) &&
					!p
						.slice(prefix.length)
						.split('/')
						.some((part) => part.startsWith('.'))
			);
			return tree(prefix, below);
		},

		async readPdfFile(path) {
			const url = disk.pdfUrl(path);
			if (!url) throw notFound(path);
			const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
			let binary = '';
			for (let i = 0; i < bytes.length; i += 0x8000) {
				binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
			}
			return btoa(binary);
		},

		embedChunks(chunks) {
			return chunks.map((chunk_text) => ({ chunk_text, embedding: vector(chunk_text) }));
		},

		openLibrary() {
			state.libraryOpen = true;
			return null;
		},

		openProject(projectRoot) {
			library();
			state.root = projectRoot;
			return null;
		},

		projectRoot: () => root(),

		hashFile(path) {
			if (!disk.has(path)) throw notFound(path);
			const known = [...state.library.values()].find((s) => s.path === path);
			return known?.sha256 ?? fakeHash(path);
		},

		registerSource(sha256, path, file_name) {
			root();
			const existing = state.library.get(sha256);
			state.project.add(sha256);
			if (existing) {
				existing.path = path;
				return false;
			}
			state.library.set(sha256, {
				sha256,
				file_name,
				path,
				csl_json: null,
				zotero_type: null,
				doi: null,
				resolved_via: null,
				state: 'pending',
				last_error: null
			});
			return true;
		},

		detectTexToolchain: () => ({ engine: null, bibliography: null }),

		compileLatex: () => ({
			ok: false,
			pdf: null,
			log: 'The browser harness has no TeX installation.'
		}),

		sourcesNeedingIngest() {
			root();
			return [...state.project]
				.map((sha) => state.library.get(sha)!)
				.filter((s) => s.state === 'pending' || s.state === 'failed')
				.map((s) => s.sha256)
				.sort();
		},

		storeChunks(sha256, chunks) {
			const source = library().get(sha256);
			if (!source) throw appError('NotFound', `No source ${sha256}.`);
			state.chunks.set(sha256, chunks);
			source.state = 'ready';
			source.last_error = null;
			return null;
		},

		markIngestFailed(sha256, error) {
			const source = library().get(sha256);
			if (source) {
				source.state = 'failed';
				source.last_error = error;
			}
			return null;
		},

		setSourceMetadata(sha256, cslJson, zoteroType, doi, resolvedVia) {
			const source = library().get(sha256);
			if (!source) throw appError('NotFound', `No source ${sha256}.`);
			Object.assign(source, {
				csl_json: cslJson,
				zotero_type: zoteroType,
				doi,
				resolved_via: resolvedVia
			});
			return null;
		},

		projectSources() {
			root();
			return [...state.project]
				.map((sha) => effective(state.library.get(sha)!))
				.sort((a, b) => a.file_name.localeCompare(b.file_name));
		},

		addToProject(sha256) {
			root();
			if (!state.library.has(sha256)) throw appError('NotFound', `No source ${sha256}.`);
			state.project.add(sha256);
			return null;
		},

		setMetadataOverride(sha256, cslJson) {
			root();
			state.overrides.set(sha256, cslJson);
			return null;
		},

		searchSources(query, limit, includeLibrary) {
			library();
			const results: ScoredChunk[] = [];
			for (const [sha256, chunks] of state.chunks) {
				const in_project = state.project.has(sha256);
				if (!in_project && !includeLibrary) continue;
				chunks.forEach((chunk, idx) =>
					results.push({
						sha256,
						idx,
						text: chunk.text,
						page_start: chunk.page_start ?? null,
						section: chunk.section ?? null,
						similarity: overlap(query, chunk.text),
						in_project
					})
				);
			}
			return results.sort(projectFirst).slice(0, limit ?? 5);
		},

		embeddingMeta: () => (library(), state.embeddingMeta),

		setEmbeddingMeta(model_id, dims) {
			library();
			state.embeddingMeta = { model_id, dims };
			return null;
		},

		importLegacyMetadata: () => ({
			imported: 0,
			already_present: 0,
			skipped_empty: 0,
			skipped_unprocessed: 0
		}),

		legacyMetadataFor: () => null,
		markLegacyConsumed: () => null,

		saveAnnotation(input) {
			library();
			const previous = state.marks.get(input.id);
			state.marks.set(input.id, {
				id: input.id,
				sha256: input.sha256,
				kind: input.kind,
				label_id: input.label_id ?? null,
				page: input.page,
				rects: input.rects ?? null,
				quote: input.quote ?? null,
				prefix: input.prefix ?? null,
				suffix: input.suffix ?? null,
				char_start: input.char_start ?? null,
				char_end: input.char_end ?? null,
				note: input.note ?? null,
				style: input.style ?? 'fill',
				page_label: input.page_label ?? null,
				origin: input.origin ?? 'erti',
				created_at: previous?.created_at ?? now(),
				updated_at: now()
			});
			return null;
		},

		annotationsForSource(sha256) {
			library();
			return [...state.marks.values()]
				.filter((m) => m.sha256 === sha256)
				.sort((a, b) => a.page - b.page || a.created_at.localeCompare(b.created_at));
		},

		// Every mark in the library, newest first, as Rust returns them: not
		// scoped to the project, and without the paper's name.
		allAnnotations(limit, offset) {
			library();
			const start = offset ?? 0;
			return newestFirst().slice(start, start + (limit ?? 200));
		},

		deleteAnnotation(id) {
			library();
			state.marks.delete(id);
			state.embedded.delete(id);
			return null;
		},

		deleteImportedAnnotations(sha256) {
			library();
			let removed = 0;
			for (const [id, m] of state.marks) {
				if (m.sha256 === sha256 && m.origin === 'imported') {
					state.marks.delete(id);
					removed++;
				}
			}
			return removed;
		},

		annotationLabels: () => (library(), [...state.labels].sort((a, b) => a.position - b.position)),

		saveLabel(label) {
			library();
			state.labels = [...state.labels.filter((l) => l.id !== label.id), label];
			return null;
		},

		deleteLabel(id) {
			library();
			state.labels = state.labels.filter((l) => l.id !== id);
			for (const m of state.marks.values()) if (m.label_id === id) m.label_id = null;
			return null;
		},

		saveReadingPosition(sha256, page) {
			library();
			state.positions.set(sha256, page);
			return null;
		},

		readingPosition: (sha256) => (library(), state.positions.get(sha256) ?? null),

		pathForSource: (sha256) => (library(), state.library.get(sha256)?.path ?? null),

		sourceForPath(path) {
			library();
			return [...state.library.values()].find((s) => s.path === path)?.sha256 ?? null;
		},

		saveAnnotationImage(id, png) {
			library();
			state.images.set(id, png);
			return null;
		},

		annotationImage: (id) => (library(), state.images.get(id) ?? null),

		embedAnnotation(id, text) {
			library();
			if (!text.trim() || state.embedded.get(id) === text) return false;
			state.embedded.set(id, text);
			return true;
		},

		embedPendingAnnotations() {
			library();
			let embedded = 0;
			for (const m of state.marks.values()) {
				if (state.embedded.has(m.id)) continue;
				state.embedded.set(m.id, `${m.quote ?? ''}\n${m.note ?? ''}`);
				embedded++;
			}
			return embedded;
		},

		// Library-wide, like Rust. Literal is SQLite's case-insensitive LIKE on
		// the quote or the note, newest first; by meaning scores every mark with a
		// vector and puts the project's first.
		searchAnnotations(query, limit, semantic) {
			library();
			const max = limit ?? 50;
			if (!semantic) {
				const needle = query.toLowerCase();
				// An empty query filters nothing, as in Rust.
				return newestFirst()
					.filter(
						(m) =>
							needle === '' ||
							m.quote?.toLowerCase().includes(needle) ||
							m.note?.toLowerCase().includes(needle)
					)
					.slice(0, max)
					.map((m) => scored(m, 1));
			}
			return [...state.marks.values()]
				.filter((m) => state.embedded.has(m.id))
				.map((m) => scored(m, overlap(query, state.embedded.get(m.id)!)))
				.sort(projectFirst)
				.slice(0, max);
		},

		restoreDefaultLabels: () => (library(), 0),

		nameLabelsAfterColours: () => (library(), 0)
	};
}

/** The directory listing `read_directory` returns, built from flat paths. */
function tree(prefix: string, paths: string[]) {
	type Item = { name: string; path: string; is_dir: boolean; children: Item[] | null };
	const top: Item[] = [];
	const dirs = new Map<string, Item>();

	for (const full of paths.sort()) {
		const parts = full.slice(prefix.length).split('/');
		let level = top;
		let at = prefix.slice(0, -1);
		parts.forEach((name, i) => {
			at = `${at}/${name}`;
			const last = i === parts.length - 1;
			if (last) {
				level.push({ name, path: at, is_dir: false, children: null });
				return;
			}
			let dir = dirs.get(at);
			if (!dir) {
				dir = { name, path: at, is_dir: true, children: [] };
				dirs.set(at, dir);
				level.push(dir);
			}
			level = dir.children!;
		});
	}
	return top;
}
