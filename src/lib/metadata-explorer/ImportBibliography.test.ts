import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
	readTextFile: vi.fn(),
	previewImport: vi.fn(),
	importEntries: vi.fn(),
	errorToast: vi.fn()
}));
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: mocks.readTextFile }));
vi.mock('./bibliography', async (real) => ({
	...(await real<typeof import('./bibliography')>()),
	previewImport: mocks.previewImport,
	importEntries: mocks.importEntries
}));
vi.mock('$lib/toast/Toast.svelte', () => ({ errorToast: mocks.errorToast }));

import type { ImportEntry } from '$lib/import';
import type { AugmentedZoteroSchema } from './adapterCslZotero';
import ImportBibliography from './ImportBibliography.svelte';
import { ImportStopped, type Preview } from './bibliography';

const schema = {} as AugmentedZoteroSchema;

const entry = (key: string): ImportEntry => ({
	key,
	line: 1,
	item: { type: 'book', title: key },
	files: []
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
	]
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
		expect(mocks.previewImport).toHaveBeenCalledWith('library.bib', '@book{…}');
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

		finish({ added: ['erti:a'], skipped: 0 });
		await vi.waitFor(() =>
			expect(onimported).toHaveBeenCalledWith({ added: ['erti:a'], skipped: 0 }, true)
		);
	});

	it('says how far an import got when it stopped, and shows what it added', async () => {
		mocks.importEntries.mockRejectedValue(
			new ImportStopped(new Error('The disk is full.'), { added: ['erti:a'], skipped: 0 })
		);
		const { onimported } = show();

		await userEvent.click(await screen.findByRole('button', { name: 'Import 1,200' }));

		await vi.waitFor(() =>
			expect(mocks.errorToast).toHaveBeenCalledWith(
				'The import stopped after 1 of 1,200: The disk is full.'
			)
		);
		expect(onimported).toHaveBeenCalledWith({ added: ['erti:a'], skipped: 0 }, false);
	});
});
