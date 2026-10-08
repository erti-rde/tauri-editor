import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	libraryWorks: vi.fn(),
	importSources: vi.fn(),
	pdfsFound: vi.fn(),
	attachFile: vi.fn()
}));
vi.mock('$lib/stores/db', () => ({
	libraryWorks: mocks.libraryWorks,
	importSources: mocks.importSources,
	pdfsFound: mocks.pdfsFound,
	attachFile: mocks.attachFile
}));

import type { ImportEntry } from '$lib/import';
import type { AugmentedZoteroSchema } from './adapterCslZotero';
import {
	attachPdfs,
	BATCH,
	commonFolder,
	fileNameOf,
	importEntries,
	ImportStopped,
	locatePdfs,
	previewImport,
	resolvePdf,
	toSource
} from './bibliography';

const schema = {
	cslToZoteroTypeMap: new Map([
		['article-journal', 'journalArticle'],
		['book', 'book']
	])
} as unknown as AugmentedZoteroSchema;

const BIB = `
@article{lecun2015,
  title = {Deep learning},
  author = {LeCun, Yann and Bengio, Yoshua},
  journal = {Nature},
  year = {2015},
  doi = {10.1038/nature14539}
}

@book{ong1982,
  title = {Orality and Literacy},
  author = {Ong, Walter J.},
  year = {1982}
}

@book{ong1982again,
  title = {Orality and literacy},
  author = {Ong, W. J.},
  year = {1982}
}

@book{untitled,
  author = {Nobody},
  year = {2001}
}

@article{fresh2024,
  title = {Something new},
  author = {Writer, A.},
  year = {2024}
}
`;

function entry(n: number, extra: Record<string, unknown> = {}, files: string[] = []): ImportEntry {
	return {
		key: `k${n}`,
		line: n,
		item: { type: 'article-journal', title: `Paper ${n}`, ...extra },
		files
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.libraryWorks.mockResolvedValue([]);
	mocks.importSources.mockImplementation(async (sources: { id: string }[]) => ({
		added: sources.map((s) => s.id),
		skipped: []
	}));
});

describe('previewImport', () => {
	// M1b-9 AC-4
	it('sorts the file against the library before anything is written', async () => {
		mocks.libraryWorks.mockResolvedValue([
			// Matched by the DOI column, though its details have none.
			{ id: 'pdf-hash', csl_json: '{"title":"Some other title"}', doi: '10.1038/nature14539' },
			{
				id: 'erti:ong',
				csl_json: JSON.stringify({
					type: 'book',
					title: 'Orality and literacy.',
					author: [{ family: 'Ong', given: 'Walter' }],
					issued: { 'date-parts': [[1982]] }
				}),
				doi: null
			},
			{ id: 'broken', csl_json: '{not json', doi: null }
		]);

		const preview = await previewImport('library.bib', BIB);

		expect(preview.fileName).toBe('library.bib');
		expect(preview.total).toBe(5);
		expect(preview.fresh.map((e) => e.key)).toEqual(['fresh2024']);
		expect(preview.known.map(({ entry, match }) => [entry.key, match])).toEqual([
			['lecun2015', { by: 'doi', id: 'pdf-hash' }],
			['ong1982', { by: 'title', id: 'erti:ong' }],
			['ong1982again', { by: 'title', id: 'erti:ong' }]
		]);
		expect(preview.unreadable).toEqual([
			{ key: 'untitled', line: expect.any(Number), reason: 'It has no title.' }
		]);
		expect(preview.pdfs).toEqual([]);
		expect(mocks.importSources).not.toHaveBeenCalled();
	});

	// M1b-9 AC-4
	it('lists the PDFs the new entries name, found from where the file is', async () => {
		mocks.libraryWorks.mockResolvedValue([
			{ id: 'erti:old', csl_json: '{"title":"Known"}', doi: '10.1/known' }
		]);
		const bib = `
@article{a, title = {Relative}, file = {Full Text:files/a.pdf:application/pdf}}
@article{b, title = {Absolute}, file = {:/Users/ako/Zotero/storage/B/b.pdf:pdf}}
@article{c, title = {Shares one}, file = {:files/a.pdf:PDF}}
@article{d, title = {Known}, doi = {10.1/known}, file = {:/elsewhere/d.pdf:PDF}}
`;

		const preview = await previewImport('/Users/ako/Papers/library.bib', bib);

		expect(preview.fresh.map((e) => e.files)).toEqual([
			['/Users/ako/Papers/files/a.pdf'],
			['/Users/ako/Zotero/storage/B/b.pdf'],
			['/Users/ako/Papers/files/a.pdf']
		]);
		// Each once; a known entry's PDF isn't imported.
		expect(preview.pdfs).toEqual([
			'/Users/ako/Papers/files/a.pdf',
			'/Users/ako/Zotero/storage/B/b.pdf'
		]);
	});

	// M1b-9 AC-1
	it('reads RIS and CSL-JSON by their extension, and refuses anything else', async () => {
		const ris = await previewImport('export.RIS', 'TY  - BOOK\r\nTI  - A book\r\nER  - \r\n');
		expect(ris.fresh).toHaveLength(1);
		const json = await previewImport('items.json', '[{"type":"book","title":"A book"}]');
		expect(json.fresh).toHaveLength(1);

		await expect(previewImport('notes.txt', 'hello')).rejects.toThrow(
			'notes.txt isn’t a .bib, .ris or .json file.'
		);
	});
});

describe('PDFs', () => {
	it('finds a relative path from the bibliography’s folder, on either OS', () => {
		expect(resolvePdf('files/a.pdf', '/Users/ako/Papers')).toBe('/Users/ako/Papers/files/a.pdf');
		expect(resolvePdf('./a.pdf', '/Users/ako/Papers/')).toBe('/Users/ako/Papers/a.pdf');
		expect(resolvePdf('/abs/a.pdf', '/Users/ako')).toBe('/abs/a.pdf');
		expect(resolvePdf('files\\a.pdf', 'C:\\Users\\ako')).toBe('C:\\Users\\ako\\files\\a.pdf');
		expect(resolvePdf('D:\\a.pdf', 'C:\\Users\\ako')).toBe('D:\\a.pdf');
		expect(resolvePdf('a.pdf', '')).toBe('a.pdf');
	});

	// M1b-9 AC-4
	it('asks which PDFs Erti can attach, a thousand at a time', async () => {
		const paths = Array.from({ length: 1_500 }, (_, n) => `/z/${n}.pdf`);
		mocks.pdfsFound.mockImplementation(async (batch: string[]) =>
			batch.map((path) => !path.endsWith('7.pdf'))
		);

		const { found, missing } = await locatePdfs(paths);

		expect(mocks.pdfsFound.mock.calls.map(([batch]) => batch.length)).toEqual([1_000, 500]);
		expect(missing).toHaveLength(150);
		expect(missing[0]).toBe('/z/7.pdf');
		expect(found.size).toBe(1_350);
	});

	it('starts the folder picker where the missing PDFs all are', () => {
		expect(
			commonFolder(['/Users/ako/Zotero/storage/A/a.pdf', '/Users/ako/Zotero/storage/B/b.pdf'])
		).toBe('/Users/ako/Zotero/storage');
		expect(commonFolder(['/Users/ako/a.pdf', '/Volumes/disk/b.pdf'])).toBe('/');
		expect(commonFolder(['C:\\Papers\\a.pdf', 'C:\\Papers\\x\\b.pdf'])).toBe('C:\\Papers');
		expect(commonFolder([])).toBeUndefined();
	});

	// M1b-9 AC-4
	it('attaches each PDF found to the source it came with, and goes on past one it can’t', async () => {
		mocks.attachFile
			.mockResolvedValueOnce({
				sha256: 'h1',
				file_name: 'a.pdf',
				needs_ingest: true,
				merged: null,
				found_again: false
			})
			.mockRejectedValueOnce(new Error('That PDF is already attached to “B”.'));
		const progress: number[] = [];

		const done = await attachPdfs(
			{
				added: ['erti:1', 'erti:2'],
				skipped: 0,
				pdfs: [
					{ work: 'erti:1', path: '/z/a.pdf' },
					{ work: 'erti:2', path: '/z/b.pdf' }
				],
				attached: [],
				unattached: []
			},
			(n) => progress.push(n)
		);

		expect(mocks.attachFile.mock.calls).toEqual([
			['erti:1', '/z/a.pdf'],
			['erti:2', '/z/b.pdf']
		]);
		expect(done.attached).toEqual([
			{ sha256: 'h1', path: '/z/a.pdf', file_name: 'a.pdf', needs_ingest: true }
		]);
		expect(done.unattached).toEqual([
			{ path: '/z/b.pdf', reason: 'That PDF is already attached to “B”.' }
		]);
		expect(done.pdfs).toEqual([]);
		expect(progress).toEqual([1, 2]);
	});
});

describe('toSource', () => {
	// M1b-9 AC-6
	it('gives an entry an id of Erti’s and the Zotero kind of its CSL type', () => {
		const source = toSource(entry(1), schema);

		expect(source.id).toMatch(/^erti:[0-9a-f-]{36}$/);
		expect(source.zotero_type).toBe('journalArticle');
		expect(JSON.parse(source.csl_json)).toEqual({
			type: 'article-journal',
			title: 'Paper 1',
			id: source.id,
			zotero_type: 'journalArticle'
		});
	});

	it('keeps a kind the form doesn’t know as a document', () => {
		const source = toSource(entry(1, { type: 'musical_score' }), schema);

		expect(source.zotero_type).toBe('document');
		expect(JSON.parse(source.csl_json).type).toBe('document');
	});
});

describe('importEntries', () => {
	// M1b-9 AC-6
	it('writes in batches, saying how far it has got after each', async () => {
		const entries = Array.from({ length: BATCH * 2 + 3 }, (_, n) => entry(n));
		const progress: [number, number][] = [];

		const imported = await importEntries(entries, schema, {
			toProject: true,
			onprogress: (done, total) => progress.push([done, total])
		});

		expect(
			mocks.importSources.mock.calls.map(([batch, toProject]) => [batch.length, toProject])
		).toEqual([
			[BATCH, true],
			[BATCH, true],
			[3, true]
		]);
		expect(progress).toEqual([
			[BATCH, entries.length],
			[BATCH * 2, entries.length],
			[entries.length, entries.length]
		]);
		expect(imported.added).toHaveLength(entries.length);
		expect(imported.skipped).toBe(0);
		expect(imported.pdfs).toEqual([]);
	});

	// M1b-9 AC-4
	it('keeps the PDFs found for what it added, to attach after', async () => {
		mocks.importSources.mockImplementation(async (sources: { id: string }[]) => ({
			// The second turned out to be in the library already.
			added: [sources[0].id, sources[2].id],
			skipped: [sources[1].id]
		}));
		const entries = [
			entry(1, {}, ['/z/one.pdf', '/z/gone.pdf']),
			entry(2, {}, ['/z/two.pdf']),
			entry(3, {}, ['/z/three.pdf'])
		];

		const imported = await importEntries(entries, schema, {
			toProject: false,
			found: new Set(['/z/one.pdf', '/z/two.pdf', '/z/three.pdf'])
		});

		expect(imported.pdfs).toEqual([
			{ work: imported.added[0], path: '/z/one.pdf' },
			{ work: imported.added[1], path: '/z/three.pdf' }
		]);
	});

	it('counts what the library gained since the preview', async () => {
		mocks.importSources.mockImplementation(async (sources: { id: string }[]) => ({
			added: sources.slice(1).map((s) => s.id),
			skipped: [sources[0].id]
		}));

		const imported = await importEntries([entry(1), entry(2)], schema, { toProject: false });

		expect(imported.added).toHaveLength(1);
		expect(imported.skipped).toBe(1);
	});

	it('stops at a batch that fails, keeping what was added before it', async () => {
		const failure = new Error('The disk is full.');
		mocks.importSources
			.mockImplementationOnce(async (sources: { id: string }[]) => ({
				added: sources.map((s) => s.id),
				skipped: []
			}))
			.mockRejectedValueOnce(failure);
		const entries = Array.from({ length: BATCH + 1 }, (_, n) => entry(n));

		const stopped = await importEntries(entries, schema, { toProject: false }).catch((e) => e);

		expect(stopped).toBeInstanceOf(ImportStopped);
		expect(stopped.reason).toBe(failure);
		expect(stopped.imported.added).toHaveLength(BATCH);
	});
});

// M1b-9 AC-6. Writing is the Rust half, timed in tests/import_sources.rs.
it('previews and batches ten thousand entries against a library of ten thousand', async () => {
	const bib = Array.from(
		{ length: 10_000 },
		(_, n) =>
			`@article{key${n},\n  title = {Paper number ${n}},\n  author = {Writer${n}, A.},\n  journal = {Journal},\n  year = {2020},\n  doi = {10.5555/new.${n}}\n}\n`
	).join('\n');
	mocks.libraryWorks.mockResolvedValue(
		Array.from({ length: 10_000 }, (_, n) => ({
			id: `erti:${n}`,
			csl_json: JSON.stringify({
				type: 'book',
				title: `Book number ${n}`,
				author: [{ family: `Author${n}` }],
				issued: { 'date-parts': [[1990]] }
			}),
			doi: `10.5555/old.${n}`
		}))
	);
	const started = performance.now();

	const preview = await previewImport('big.bib', bib);
	let last = 0;
	await importEntries(preview.fresh, schema, {
		toProject: true,
		onprogress: (done) => (last = done)
	});
	const took = performance.now() - started;

	expect(preview.fresh).toHaveLength(10_000);
	expect(last).toBe(10_000);
	expect(mocks.importSources).toHaveBeenCalledTimes(10_000 / BATCH);
	// The whole import has 30 s on the dev machine; this half takes a few.
	expect(took).toBeLessThan(15_000);
}, 30_000);

it('takes the file name from a path either OS writes', () => {
	expect(fileNameOf('/Users/ako/Zotero/library.bib')).toBe('library.bib');
	expect(fileNameOf('C:\\Users\\ako\\export.ris')).toBe('export.ris');
});
