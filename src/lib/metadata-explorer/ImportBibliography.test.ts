import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
	readTextFile: vi.fn(),
	previewImport: vi.fn(),
	importEntries: vi.fn(),
	locatePdfs: vi.fn(),
	attachPdfs: vi.fn(),
	pickFolder: vi.fn(),
	errorToast: vi.fn()
}));
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: mocks.readTextFile }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.pickFolder }));
vi.mock('./bibliography', async (real) => ({
	...(await real<typeof import('./bibliography')>()),
	previewImport: mocks.previewImport,
	importEntries: mocks.importEntries,
	locatePdfs: mocks.locatePdfs,
	attachPdfs: mocks.attachPdfs
}));
vi.mock('$lib/toast/Toast.svelte', () => ({ errorToast: mocks.errorToast }));

import type { ImportEntry } from '$lib/import';
import type { AugmentedZoteroSchema } from './adapterCslZotero';
import ImportBibliography from './ImportBibliography.svelte';
import { ImportStopped, type Imported, type Preview } from './bibliography';

const schema = {} as AugmentedZoteroSchema;

const entry = (key: string, files: string[] = []): ImportEntry => ({
	key,
	line: 1,
	item: { type: 'book', title: key },
	files
});

const imported = (added: string[], more: Partial<Imported> = {}): Imported => ({
	added,
	skipped: 0,
	pdfs: [],
	attached: [],
	unattached: [],
	...more
});

const PREVIEW: Preview = {
	fileName: 'library.bib',
	total: 1_236,
	fresh: Array.from({ length: 1_200 }, (_, n) => entry(`new${n}`)),
	known: [{ entry: entry('old'), match: { by: 'doi', id: 'erti:old' } }],
	repeated: [{ entry: entry('twice'), of: 'new1' }],
	unreadable: [
		{ key: 'smith2020', line: 12, reason: 'It has no end (ER).' },
		{ key: null, line: 40, reason: 'A field outside any entry (no TY before it).' },
		...Array.from({ length: 32 }, (_, n) => ({
			key: `bad${n}`,
			line: 100 + n,
			reason: 'It has no title.'
		}))
	],
	pdfs: []
};

const ZOTERO = '/Users/ako/Zotero/storage';
/** Two new entries with a PDF each, and one whose PDF isn't where Erti can see. */
const WITH_PDFS: Preview = {
	...PREVIEW,
	total: 3,
	fresh: [
		entry('lecun', [`${ZOTERO}/AB12/lecun.pdf`]),
		entry('ong', [`${ZOTERO}/CD34/ong.pdf`]),
		entry('sennett', [`${ZOTERO}/EF56/sennett.pdf`])
	],
	known: [],
	repeated: [],
	unreadable: [],
	pdfs: [`${ZOTERO}/AB12/lecun.pdf`, `${ZOTERO}/CD34/ong.pdf`, `${ZOTERO}/EF56/sennett.pdf`]
};

function show(path: string | null = '/Users/ako/Zotero/library.bib') {
	const onimported = vi.fn();
	const onclose = vi.fn();
	render(ImportBibliography, { props: { path, schema, onimported, onclose } });
	return { onimported, onclose };
}

beforeEach(() => {
	mocks.readTextFile.mockResolvedValue('@book{…}');
	mocks.previewImport.mockResolvedValue(PREVIEW);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('ImportBibliography', () => {
	// M1b-9 AC-4
	it('previews the file against the library before writing anything', async () => {
		show();

		const summary = await screen.findByTestId('import-summary');
		expect(screen.getByRole('dialog', { name: 'Import library.bib' })).toBeInTheDocument();
		expect(mocks.readTextFile).toHaveBeenCalledWith('/Users/ako/Zotero/library.bib');
		expect(mocks.previewImport).toHaveBeenCalledWith('/Users/ako/Zotero/library.bib', '@book{…}');
		expect(summary).toHaveTextContent(
			'1,236 entries · 1,200 new · 1 already in your library (matched by DOI or title) · 1 listed twice in the file · 34 unreadable'
		);
		expect(
			screen.getByRole('checkbox', { name: 'Also add them to this project' })
		).not.toBeChecked();
		expect(screen.getByRole('button', { name: 'Import 1,200' })).toBeInTheDocument();
		expect(mocks.importEntries).not.toHaveBeenCalled();
	});

	// M1b-9 AC-4
	it('lists what it couldn’t read, with where and why', async () => {
		show();

		const items = await screen.findAllByRole('listitem');
		expect(items[0]).toHaveTextContent('smith2020, line 12: It has no end (ER).');
		expect(items[1]).toHaveTextContent('Line 40: A field outside any entry (no TY before it).');
		expect(items).toHaveLength(34);
	});

	it('says why a file can’t be imported at all', async () => {
		mocks.previewImport.mockRejectedValue(new Error('notes.txt isn’t a .bib, .ris or .json file.'));
		show('/tmp/notes.txt');

		expect(
			await screen.findByText('Erti can’t import it. notes.txt isn’t a .bib, .ris or .json file.')
		).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /^Import/ })).toBeNull();
	});

	it('offers nothing to import when the library has all of it', async () => {
		mocks.previewImport.mockResolvedValue({ ...PREVIEW, fresh: [], unreadable: [] });
		show();

		expect(
			await screen.findByText('There’s nothing in it your library doesn’t have.')
		).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /^Import/ })).toBeNull();
	});

	// M1b-9 AC-6
	it('imports what’s new, with progress, into the project when asked', async () => {
		let report: (done: number, total: number) => void = () => {};
		let finish: (value: unknown) => void = () => {};
		mocks.importEntries.mockImplementation((_entries, _schema, options) => {
			report = options.onprogress;
			return new Promise((resolve) => (finish = resolve));
		});
		const { onimported } = show();

		await userEvent.click(
			await screen.findByRole('checkbox', { name: 'Also add them to this project' })
		);
		await userEvent.click(screen.getByRole('button', { name: 'Import 1,200' }));

		expect(mocks.importEntries).toHaveBeenCalledWith(PREVIEW.fresh, schema, {
			toProject: true,
			onprogress: expect.any(Function)
		});
		report(500, 1_200);
		expect(
			await screen.findByRole('button', { name: 'Importing 500 of 1,200…' })
		).toBeInTheDocument();
		expect(screen.getByRole('progressbar', { name: 'Importing' })).toHaveAttribute(
			'aria-valuenow',
			'500'
		);

		finish(imported(['erti:a']));
		await vi.waitFor(() => expect(onimported).toHaveBeenCalledWith(imported(['erti:a']), true));
		expect(mocks.attachPdfs).not.toHaveBeenCalled();
	});

	it('says how far an import got when it stopped, and shows what it added', async () => {
		mocks.importEntries.mockRejectedValue(
			new ImportStopped(new Error('The disk is full.'), imported(['erti:a']))
		);
		const { onimported } = show();

		await userEvent.click(await screen.findByRole('button', { name: 'Import 1,200' }));

		await vi.waitFor(() =>
			expect(mocks.errorToast).toHaveBeenCalledWith(
				'The import stopped after 1 of 1,200: The disk is full.'
			)
		);
		expect(onimported).toHaveBeenCalledWith(imported(['erti:a']), false);
	});

	// M1b-9 AC-4
	it('says which PDFs it will attach and which it can’t find, and looks again in a folder picked', async () => {
		mocks.previewImport.mockResolvedValue(WITH_PDFS);
		mocks.locatePdfs.mockResolvedValueOnce({
			found: new Set([`${ZOTERO}/AB12/lecun.pdf`]),
			missing: [`${ZOTERO}/CD34/ong.pdf`, `${ZOTERO}/EF56/sennett.pdf`]
		});
		mocks.locatePdfs.mockResolvedValueOnce({
			found: new Set([`${ZOTERO}/AB12/lecun.pdf`, `${ZOTERO}/CD34/ong.pdf`]),
			missing: [`${ZOTERO}/EF56/sennett.pdf`]
		});
		mocks.pickFolder.mockResolvedValue('/Users/ako/Zotero');
		show();

		const summary = await screen.findByTestId('import-summary');
		await vi.waitFor(() =>
			expect(summary).toHaveTextContent(
				'3 entries · 3 new · 0 already in your library (matched by DOI or title) · 1 with a PDF that will be attached · 2 PDFs not found'
			)
		);
		expect(mocks.locatePdfs).toHaveBeenCalledWith(WITH_PDFS.pdfs);
		const missing = screen.getByRole('list', { name: 'PDFs not found' });
		expect(missing).toHaveTextContent(`${ZOTERO}/CD34/ong.pdf`);
		expect(missing).toHaveTextContent(`${ZOTERO}/EF56/sennett.pdf`);

		await userEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));

		expect(mocks.pickFolder).toHaveBeenCalledWith(
			expect.objectContaining({ directory: true, recursive: true, defaultPath: ZOTERO })
		);
		await vi.waitFor(() =>
			expect(summary).toHaveTextContent('2 with a PDF that will be attached · 1 PDF not found')
		);
		expect(mocks.importEntries).not.toHaveBeenCalled();
	});

	// M1b-9 AC-4
	it('attaches the PDFs it found to what it imported, with progress', async () => {
		const found = new Set([`${ZOTERO}/AB12/lecun.pdf`]);
		mocks.previewImport.mockResolvedValue(WITH_PDFS);
		mocks.locatePdfs.mockResolvedValue({ found, missing: [] });
		const pdfs = [{ work: 'erti:lecun', path: `${ZOTERO}/AB12/lecun.pdf` }];
		mocks.importEntries.mockResolvedValue(imported(['erti:lecun'], { pdfs }));
		let report: (done: number, total: number) => void = () => {};
		let finish: (value: Imported) => void = () => {};
		mocks.attachPdfs.mockImplementation((_imported, onprogress) => {
			report = onprogress;
			return new Promise((resolve) => (finish = resolve));
		});
		const { onimported } = show();

		await vi.waitFor(() =>
			expect(screen.getByTestId('import-summary')).toHaveTextContent('1 with a PDF')
		);
		await userEvent.click(screen.getByRole('button', { name: 'Import 3' }));

		expect(mocks.importEntries).toHaveBeenCalledWith(
			WITH_PDFS.fresh,
			schema,
			expect.objectContaining({ found })
		);
		await vi.waitFor(() =>
			expect(mocks.attachPdfs).toHaveBeenCalledWith(
				imported(['erti:lecun'], { pdfs }),
				expect.any(Function)
			)
		);
		report(0, 1);
		expect(
			await screen.findByRole('button', { name: 'Attaching 0 of 1 PDFs…' })
		).toBeInTheDocument();
		expect(screen.getByRole('progressbar', { name: 'Attaching PDFs' })).toBeInTheDocument();

		const done = imported(['erti:lecun'], {
			attached: [{ sha256: 'abc', path: pdfs[0].path, file_name: 'lecun.pdf', needs_ingest: true }]
		});
		finish(done);
		await vi.waitFor(() => expect(onimported).toHaveBeenCalledWith(done, false));
	});
});
