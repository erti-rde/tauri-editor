import type {
	commands,
	Annotation,
	AnnotationLabel,
	AppError,
	ErrorKind,
	Hit,
	HitKind,
	NewChunk,
	ScoredAnnotation,
	ScoredChunk,
	ScoredSourceNote,
	Source,
	SourceNote
} from '$lib/ipc';

import type { Fixture, LibrarySource } from './fixture';

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
	/** What the user picked in a dialog this session, as `scope::Grants` holds it. */
	granted: string[];
	libraryOpen: boolean;
	/** Every source the library knows, by hash. */
	library: Map<string, LibrarySource>;
	/** The open project's sources. */
	project: Set<string>;
	/** Project-local metadata corrections. */
	overrides: Map<string, string>;
	/** Alias → canonical id, as `source_aliases` holds them. Never chained. */
	aliases: Map<string, string>;
	chunks: Map<string, NewChunk[]>;
	marks: Map<string, Annotation>;
	/** Notes on a work (ADR 004), by id, in the order first written. */
	sourceNotes: Map<string, SourceNote>;
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
		granted: [],
		libraryOpen: false,
		library,
		project: new Set(library.keys()),
		overrides: new Map(),
		aliases: new Map(Object.entries(fixture.aliases ?? {})),
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
		sourceNotes: new Map((fixture.notes ?? []).map((n) => [n.id, structuredClone(n)])),
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
	// As `queries::resolve`: one lookup, and an unknown id is its own.
	const canon = (id: string) => state.aliases.get(id) ?? id;

	/** As `queries::normalise_doi`: lowercase, bare of a resolver's prefix. */
	function normaliseDoi(doi: unknown): string | null {
		if (typeof doi !== 'string') return null;
		const lower = doi.trim().toLowerCase();
		const prefix = [
			'https://doi.org/',
			'http://doi.org/',
			'https://dx.doi.org/',
			'http://dx.doi.org/',
			'doi:'
		].find((p) => lower.startsWith(p));
		const bare = (prefix ? lower.slice(prefix.length) : lower).trim();
		return bare || null;
	}

	/** As `queries::source_for_doi`: the column, else the details' own DOI, normalised. */
	function doiOwner(doi: string): string | null {
		const wanted = normaliseDoi(doi);
		if (!wanted) return null;
		for (const s of state.library.values()) {
			let own: unknown = s.doi;
			if (own === null) {
				try {
					own = (JSON.parse(s.csl_json ?? '') as { DOI?: unknown }).DOI ?? null;
				} catch {
					own = null;
				}
			}
			// Rust compares whatever's stored as text; a DOI that isn't a string
			// (a number in imported details) is no match, never an error.
			if (normaliseDoi(own) === wanted) return canon(s.sha256);
		}
		return null;
	}

	/** As `checked_work`: an `erti:` id and a title. The DOI, normalised. */
	function checkWork(id: string, cslJson: string): string | null {
		if (!/^erti:[0-9a-f-]{36}$/i.test(id)) {
			throw appError('InvalidInput', "That isn't an id for a source entered by hand.");
		}
		const csl = JSON.parse(cslJson) as { title?: unknown; DOI?: unknown };
		if (typeof csl.title !== 'string' || !csl.title.trim()) {
			throw appError('InvalidInput', 'Give the source a title.');
		}
		return normaliseDoi(csl.DOI);
	}

	function insertWork(
		id: string,
		cslJson: string,
		zoteroType: string,
		doi: string | null,
		resolvedVia: string
	) {
		state.library.set(id, {
			sha256: id,
			file_name: '',
			path: null,
			csl_json: cslJson,
			zotero_type: zoteroType,
			doi,
			resolved_via: resolvedVia,
			state: 'ready',
			last_error: null
		});
	}

	/** As `add_work_in`: by hand, or from a DOI, and never a DOI twice. */
	function addWork(id: string, cslJson: string, zoteroType: string, fromDoi: boolean) {
		library();
		const doi = checkWork(id, cslJson);
		if (fromDoi && !doi) throw appError('InvalidInput', 'Those details have no DOI.');
		if (doi && doiOwner(doi)) {
			throw appError('Conflict', 'A source with that DOI is already in the library.');
		}
		if (state.library.has(id)) {
			throw appError('Conflict', 'A source with that id is already in the library.');
		}
		insertWork(id, cslJson, zoteroType, doi, fromDoi ? 'manual' : 'by-hand');
		if (state.root !== null) state.project.add(id);
	}
	const projectWorks = () => new Set([...state.project].map(canon));
	// As `queries::work_and_files`: the work, then every file attached to it.
	const workAndFiles = (id: string) => {
		const work = canon(id);
		const files = [...state.aliases].filter(([, w]) => w === work).map(([alias]) => alias);
		return [work, ...files.sort()];
	};
	// An override made on an alias still corrects the work, unless the work has
	// its own. A work with no file opens its alias's, and says whose file it is.
	const effective = (s: LibrarySource): Source => {
		const aliases = [...state.aliases].filter(([, work]) => work === s.sha256).map(([a]) => a);
		const override = [s.sha256, ...aliases].map((id) => state.overrides.get(id)).find(Boolean);
		const file = s.path ? s : aliases.map((a) => state.library.get(a)).find((f) => f?.path);
		return {
			...s,
			csl_json: override ?? s.csl_json,
			path: file?.path ?? null,
			file_sha256: file?.sha256 ?? null,
			file_name: file?.file_name ?? s.file_name,
			// The file's own reading, which for an attached PDF isn't the work's.
			file_state: file?.state ?? null,
			file_error: file?.last_error ?? null
		};
	};
	const titleOf = (id: string): string | null => {
		const title = JSON.parse(state.library.get(id)?.csl_json ?? '{}').title;
		return typeof title === 'string' ? title : null;
	};
	const newestFirst = () =>
		[...state.marks.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
	// Project first, then by score: the order both Rust searches use.
	const projectFirst = <T extends { in_project: boolean; similarity: number | null }>(a: T, b: T) =>
		Number(b.in_project) - Number(a.in_project) || (b.similarity ?? 0) - (a.similarity ?? 0);
	const fileName = (sha: string) => state.library.get(sha)?.file_name ?? null;
	const scored = (m: Annotation, similarity: number): ScoredAnnotation => ({
		...m,
		similarity,
		source_id: canon(m.sha256),
		in_project: projectWorks().has(canon(m.sha256)),
		file_name: fileName(m.sha256)
	});
	const scoredNote = (n: SourceNote, similarity: number): ScoredSourceNote => ({
		...n,
		similarity,
		source_id: canon(n.sha256),
		in_project: projectWorks().has(canon(n.sha256)),
		title: titleOf(canon(n.sha256)) ?? fileName(canon(n.sha256))
	});
	// As `source_note_text`: the words quoted, then the note.
	const noteText = (n: SourceNote) =>
		[n.quote?.trim(), n.body.trim()].filter(Boolean).join(' \u2014 ');
	// Every passage, scored, inside the scope: what the index ranks.
	const passages = (query: string, includeLibrary: boolean): ScoredChunk[] => {
		const results: ScoredChunk[] = [];
		const works = projectWorks();
		for (const [sha256, chunks] of state.chunks) {
			const source_id = canon(sha256);
			const in_project = works.has(source_id);
			if (!in_project && !includeLibrary) continue;
			chunks.forEach((chunk, idx) =>
				results.push({
					sha256,
					source_id,
					idx,
					text: chunk.text,
					page_start: chunk.page_start ?? null,
					section: chunk.section ?? null,
					similarity: overlap(query, chunk.text),
					in_project
				})
			);
		}
		return results;
	};
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

		// There's no log folder to show; journeys check the call was made.
		openLogFolder() {
			return null;
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

		// A folder Erti has opened before carries `.erti/project.db`, as in Rust,
		// which also answers false for a path that isn't absolute.
		recentProjectsPresent: (paths) =>
			paths.map(
				(path, i) =>
					i < 100 &&
					path.startsWith('/') &&
					!path.startsWith('//') &&
					disk.has(`${path}/.erti/project.db`)
			),

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
				.flatMap((sha) => state.library.get(sha) ?? [])
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
			// A removed work stays in the project's set, as in Rust, and isn't listed.
			return [...projectWorks()]
				.flatMap((sha) => {
					const source = state.library.get(sha);
					return source ? [effective(source)] : [];
				})
				.sort((a, b) => a.file_name.localeCompare(b.file_name));
		},

		sourceAliases() {
			library();
			return Object.fromEntries(state.aliases);
		},

		addSourceFromManuscript(id, cslJson) {
			root();
			state.project.add(id);
			if (state.library.has(id)) return false;
			const csl = JSON.parse(cslJson);
			state.library.set(id, {
				sha256: id,
				file_name: '',
				path: null,
				csl_json: cslJson,
				zotero_type: typeof csl.zotero_type === 'string' ? csl.zotero_type : null,
				doi: typeof csl.DOI === 'string' ? csl.DOI : null,
				resolved_via: 'manuscript',
				state: 'ready',
				last_error: null
			});
			return true;
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
			return passages(query, !!includeLibrary)
				.sort(projectFirst)
				.slice(0, limit ?? 5);
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

		addSourceByHand(id, cslJson, zoteroType) {
			addWork(id, cslJson, zoteroType, false);
			return null;
		},
		addSourceFromDoi(id, cslJson, zoteroType) {
			addWork(id, cslJson, zoteroType, true);
			return null;
		},
		libraryWorks() {
			return [...library().values()]
				.filter((s) => s.csl_json !== null || s.doi !== null)
				.map((s) => ({ id: canon(s.sha256), csl_json: s.csl_json, doi: s.doi }));
		},
		// As `import_sources_in`: every source checked before any is written,
		// and a DOI or id the library has is skipped rather than refused.
		importSources(sources, toProject) {
			library();
			if (sources.length > 500) {
				throw appError('InvalidInput', 'Import at most 500 sources at a time.');
			}
			const dois = sources.map((s) => checkWork(s.id, s.csl_json));
			if (toProject) root();
			const added: string[] = [];
			const skipped: string[] = [];
			sources.forEach((s, i) => {
				const doi = dois[i];
				if ((doi && doiOwner(doi)) || state.library.has(s.id)) {
					skipped.push(s.id);
					return;
				}
				insertWork(s.id, s.csl_json, s.zotero_type, doi, 'import');
				added.push(s.id);
			});
			if (toProject) added.forEach((id) => state.project.add(id));
			return { added, skipped };
		},
		// As `pdfs_found_in`: in the project, a picked folder or a place the
		// library has a file at, and a PDF.
		pdfsFound(paths) {
			if (paths.length > 1000)
				throw appError('InvalidInput', 'Look for at most 1000 files at a time.');
			const within = (path: string, folder: string) =>
				path === folder || path.startsWith(`${folder}/`);
			return paths.map(
				(path) =>
					disk.pdfUrl(path) !== undefined &&
					([...(state.root ? [state.root] : []), ...state.granted].some((f) => within(path, f)) ||
						[...state.library.values()].some((s) => s.path === path))
			);
		},
		sourceForDoi(doi) {
			library();
			return doiOwner(doi);
		},

		// As `queries::attach_file`: the file keeps its own row, and an alias
		// makes it the work's. Refused rather than moved when another work has it.
		attachFile(work, path) {
			root();
			if (!disk.has(path)) throw notFound(path);
			const known = [...state.library.values()].find((s) => s.path === path);
			const sha256 = known?.sha256 ?? fakeHash(path);
			const target = canon(work);
			if (!state.library.has(target)) {
				throw appError('NotFound', 'That source is no longer in the library.');
			}
			const file_name = path.split('/').pop() ?? path;
			if (sha256 === target || state.aliases.get(sha256) === target) {
				// Picked again from a new place: found, as Rust records it.
				const file = state.library.get(sha256)!;
				if (file.path === path) {
					throw appError('Conflict', 'That PDF is already attached to this source.');
				}
				file.path = path;
				return {
					sha256,
					file_name,
					needs_ingest: file.state !== 'ready',
					merged: null,
					found_again: true
				};
			}
			const owner = state.aliases.get(sha256);
			if (owner) {
				const title = titleOf(owner);
				throw appError(
					'Conflict',
					title
						? `That PDF is already attached to “${title}”.`
						: 'That PDF is already attached to another source.'
				);
			}
			if ([...state.aliases.values()].includes(sha256)) {
				const title = titleOf(sha256);
				throw appError(
					'Conflict',
					`That PDF is ${title ? `“${title}”` : 'a source'}, which has files of its own, so it can't be another source's file.`
				);
			}
			const existing = state.library.get(sha256);
			const merged = existing ? (titleOf(sha256) ?? file_name) : null;
			if (existing) existing.path = path;
			else {
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
			}
			state.aliases.set(sha256, target);
			// As `alias_source`: the file's own notes move to the work.
			for (const n of state.sourceNotes.values()) if (n.sha256 === sha256) n.sha256 = target;
			const file = state.library.get(sha256)!;
			return {
				sha256,
				file_name,
				needs_ingest: file.state !== 'ready',
				merged,
				found_again: false
			};
		},

		// As `queries::source_file_locations`: the work's own file, then the
		// attached ones by name.
		sourceFiles(id) {
			library();
			const [work, ...attached] = workAndFiles(id);
			const byName = (a: string, b: string) =>
				(state.library.get(a)?.file_name ?? '').localeCompare(
					state.library.get(b)?.file_name ?? ''
				);
			return [work, ...attached.sort(byName)].flatMap((sha256) => {
				const file = state.library.get(sha256);
				if (!file?.path) return [];
				return [
					{
						sha256,
						file_name: file.file_name,
						path: file.path,
						found: disk.has(file.path),
						state: file.state,
						last_error: file.last_error
					}
				];
			});
		},

		sourceRemoval(id) {
			library();
			const files = workAndFiles(id);
			const marks = [...state.marks.values()].filter((m) => files.includes(m.sha256));
			const notes = [...state.sourceNotes.values()].filter((n) => files.includes(n.sha256));
			return {
				notes: notes.length + marks.filter((m) => m.kind === 'page-note').length,
				highlights: marks.filter((m) => m.kind !== 'page-note').length,
				paths: files.flatMap((sha) => state.library.get(sha)?.path ?? []).sort()
			};
		},

		removeSource(id) {
			library();
			const files = workAndFiles(id);
			for (const sha of files) {
				state.library.delete(sha);
				state.chunks.delete(sha);
				state.positions.delete(sha);
			}
			for (const [markId, m] of state.marks) {
				if (!files.includes(m.sha256)) continue;
				state.marks.delete(markId);
				state.embedded.delete(markId);
				state.images.delete(markId);
			}
			for (const [noteId, n] of state.sourceNotes) {
				if (files.includes(n.sha256)) state.sourceNotes.delete(noteId);
			}
			for (const [alias, work] of state.aliases) {
				if (files.includes(alias) || files.includes(work)) state.aliases.delete(alias);
			}
			return null;
		},

		workNotes(id) {
			library();
			const group = workAndFiles(id);
			// As Rust: the work's own file, then attached ones by name; marks file
			// by file, by page within each.
			const files = group
				.flatMap((sha256) => {
					const file = state.library.get(sha256);
					return file?.path ? [{ sha256, file_name: file.file_name }] : [];
				})
				.sort(
					(a, b) =>
						Number(a.sha256 !== group[0]) - Number(b.sha256 !== group[0]) ||
						a.file_name.localeCompare(b.file_name)
				);
			const rank = (sha: string) => {
				const i = files.findIndex((f) => f.sha256 === sha);
				return i === -1 ? files.length : i;
			};
			return {
				notes: [...state.sourceNotes.values()].filter((n) => n.sha256 === group[0]),
				marks: [...state.marks.values()]
					.filter((m) => group.includes(m.sha256))
					.sort(
						(a, b) =>
							rank(a.sha256) - rank(b.sha256) ||
							a.page - b.page ||
							a.created_at.localeCompare(b.created_at)
					),
				files
			};
		},

		// As `save_source_note_in`: trimmed (the body at its end only), blanks
		// absent, kept on the work.
		saveSourceNote(input) {
			library();
			const given = (value: string | null | undefined) => value?.trim() || null;
			const body = input.body.trimEnd();
			const quote = given(input.quote);
			const page_label = given(input.page_label);
			if (!input.id || input.id.length > 200) {
				throw appError('InvalidInput', "That isn't a note id.");
			}
			if (!body.trim() && !quote) {
				throw appError('InvalidInput', "Write a note, or the words you're quoting.");
			}
			if ([...body].length > 200_000 || [...(quote ?? '')].length > 200_000) {
				throw appError('InvalidInput', 'That note is too long to keep.');
			}
			if (page_label && [...page_label].length > 100) {
				throw appError('InvalidInput', 'A page is a number or a short label, such as 853 or xiv.');
			}
			const work = canon(input.sha256);
			if (!state.library.has(work)) {
				throw appError('NotFound', "That source isn't in the library any more.");
			}
			const previous = state.sourceNotes.get(input.id);
			state.sourceNotes.set(input.id, {
				id: input.id,
				sha256: previous?.sha256 ?? work,
				body,
				quote,
				page_label,
				label_id: given(input.label_id),
				created_at: previous?.created_at ?? now(),
				updated_at: now()
			});
			return null;
		},

		deleteSourceNote(id) {
			library();
			state.sourceNotes.delete(id);
			state.embedded.delete(id);
			return null;
		},

		// As `embed_source_note`: the words read back, and skipped when they're
		// what was last embedded. Notes share `embedded` with marks: the ids are
		// uuids either way.
		embedSourceNote(id) {
			library();
			const note = state.sourceNotes.get(id);
			const text = note ? noteText(note) : '';
			if (!text || state.embedded.get(id) === text) return false;
			state.embedded.set(id, text);
			return true;
		},

		// Named as a search result names the work, as in Rust.
		allSourceNotes: () => (
			library(),
			[...state.sourceNotes.values()]
				.sort(
					(a, b) => a.sha256.localeCompare(b.sha256) || a.created_at.localeCompare(b.created_at)
				)
				.map((n) => ({ ...n, title: titleOf(canon(n.sha256)) ?? fileName(canon(n.sha256)) }))
		),

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
			for (const n of state.sourceNotes.values()) {
				if (state.embedded.has(n.id)) continue;
				state.embedded.set(n.id, noteText(n));
				embedded++;
			}
			return embedded;
		},

		// Library-wide, like Rust, marks and source notes together. Literal is
		// SQLite's case-insensitive LIKE on the quote or the note, the project's
		// first and then newest; by meaning scores every note with a vector and
		// puts the project's first.
		searchNotes(query, limit, semantic) {
			library();
			const max = limit ?? 50;
			const notes = [...state.sourceNotes.values()];
			if (!semantic) {
				const needle = query.toLowerCase();
				const has = (text: string | null | undefined) =>
					needle === '' || !!text?.toLowerCase().includes(needle);
				// An empty query filters nothing, as in Rust.
				const hits: Hit[] = [
					...newestFirst()
						.filter((m) => has(m.quote) || has(m.note))
						.map((m) => ({ kind: 'annotation' as const, hit: scored(m, 1) })),
					...notes
						.filter((n) => has(n.quote) || has(n.body))
						.map((n) => ({ kind: 'source_note' as const, hit: scoredNote(n, 1) }))
				];
				const created = (hit: Hit) => (hit.kind === 'chunk' ? '' : hit.hit.created_at);
				return hits
					.sort(
						(a, b) =>
							Number(b.hit.in_project) - Number(a.hit.in_project) ||
							created(b).localeCompare(created(a))
					)
					.slice(0, max);
			}
			const hits: Hit[] = [
				...[...state.marks.values()]
					.filter((m) => state.embedded.has(m.id))
					.map((m) => ({
						kind: 'annotation' as const,
						hit: scored(m, overlap(query, state.embedded.get(m.id)!))
					})),
				...notes
					.filter((n) => state.embedded.has(n.id))
					.map((n) => ({
						kind: 'source_note' as const,
						hit: scoredNote(n, overlap(query, state.embedded.get(n.id)!))
					}))
			];
			return hits.sort((a, b) => projectFirst(a.hit, b.hit)).slice(0, max);
		},

		searchLibrary(query, kinds, limit, includeLibrary) {
			library();
			const wanted = (kind: HitKind) => !kinds?.length || kinds.includes(kind);
			const hits: Hit[] = [];
			if (wanted('chunk')) {
				for (const hit of passages(query, !!includeLibrary)) hits.push({ kind: 'chunk', hit });
			}
			if (wanted('annotation')) {
				for (const m of state.marks.values()) {
					const vector = state.embedded.get(m.id);
					if (vector === undefined) continue;
					const hit = scored(m, overlap(query, vector));
					if (hit.in_project || includeLibrary) hits.push({ kind: 'annotation', hit });
				}
			}
			if (wanted('source_note')) {
				for (const n of state.sourceNotes.values()) {
					const vector = state.embedded.get(n.id);
					if (vector === undefined) continue;
					const hit = scoredNote(n, overlap(query, vector));
					if (hit.in_project || includeLibrary) hits.push({ kind: 'source_note', hit });
				}
			}
			return hits.sort((a, b) => projectFirst(a.hit, b.hit)).slice(0, limit ?? 20);
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
