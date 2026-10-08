import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';

const { projectSources, retryIngest, attachPdf, pickFile, importing, successToast } = vi.hoisted(
	() => ({
		projectSources: vi.fn(),
		retryIngest: vi.fn(),
		attachPdf: vi.fn(),
		pickFile: vi.fn(),
		importing: { previewImport: vi.fn(), importEntries: vi.fn() },
		successToast: vi.fn()
	})
);

vi.mock('$lib/stores/db', () => ({ projectSources, setMetadataOverride: vi.fn() }));
vi.mock('$utils/pdf_handlers', () => ({ retryIngest, applyManualDoi: vi.fn() }));
vi.mock('./adapterCslZotero', () => ({ augmentSchema: vi.fn(async () => null) }));
vi.mock('./attach', () => ({ attachPdf }));
vi.mock('$lib/toast/Toast.svelte', () => ({ errorToast: vi.fn(), successToast }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: pickFile }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: vi.fn(async () => '') }));
vi.mock('./bibliography', async (real) => ({
	...(await real<typeof import('./bibliography')>()),
	...importing
}));

import userEvent from '@testing-library/user-event';
import { augmentSchema } from './adapterCslZotero';
import MetadataEditor from './MetadataEditor.svelte';

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('MetadataEditor', () => {
	// M1b-3: a work with no file of its own lists the PDF attached to it.
	it('retries a PDF attached to a work under the PDF’s own hash', async () => {
		projectSources.mockResolvedValue([
			{
				sha256: 'erti:book',
				file_name: 'book.pdf',
				path: '/papers/book.pdf',
				file_sha256: 'pdf',
				csl_json: null,
				zotero_type: null,
				doi: null,
				resolved_via: null,
				state: 'failed',
				last_error: 'No text'
			}
		]);
		const view = render(MetadataEditor);

		await fireEvent.click(await view.findByRole('button', { name: 'Retry' }));

		expect(retryIngest).toHaveBeenCalledWith({
			sha256: 'pdf',
			path: '/papers/book.pdf',
			file_name: 'book.pdf'
		});
	});

	// M1b-5 AC-4, M1b-7 AC-1
	it('offers Attach PDF… on a row with no file, and lists the rows again', async () => {
		projectSources.mockResolvedValue([
			row({ sha256: 'erti:book', csl_json: '{"type":"book","title":"Orality and Literacy"}' })
		]);
		const view = render(MetadataEditor);

		expect(await view.findByText('No file')).toBeTruthy();
		await fireEvent.click(view.getByRole('button', { name: 'Attach PDF to Orality and Literacy' }));
		expect(attachPdf).toHaveBeenCalledWith('erti:book', expect.any(Function));
	});

	// M1b-7 AC-1
	it('follows the attached file’s reading, not the work’s own state', async () => {
		const book = {
			sha256: 'erti:book',
			csl_json: '{"type":"book","title":"Orality and Literacy"}',
			file_name: 'ong.pdf',
			path: '/papers/ong.pdf',
			file_sha256: 'pdf'
		};
		projectSources.mockResolvedValue([row({ ...book, file_state: 'pending' })]);
		const view = render(MetadataEditor);
		expect(await view.findByText('· Reading…')).toBeTruthy();
		view.unmount();

		projectSources.mockResolvedValue([
			row({ ...book, file_state: 'failed', file_error: 'No text' })
		]);
		const failed = render(MetadataEditor);
		expect(await failed.findByText('No text')).toBeTruthy();
		expect(failed.getByText('· Couldn’t read')).toBeTruthy();
		// It has details; what needs looking at is the file, not a DOI.
		expect(failed.getByRole('button', { name: 'Retry' })).toBeTruthy();
		expect(failed.queryByRole('button', { name: 'Enter DOI' })).toBeNull();
	});

	// M1b-9 AC-1, UX-6
	it('imports a bibliography, then lists what it added until the filter is cleared', async () => {
		vi.mocked(augmentSchema).mockResolvedValueOnce({ cslToZoteroTypeMap: new Map() } as never);
		const before = row({ sha256: 'erti:old', csl_json: '{"type":"book","title":"Already here"}' });
		const added = row({ sha256: 'erti:new', csl_json: '{"type":"book","title":"Just imported"}' });
		projectSources.mockResolvedValue([before]);
		pickFile.mockResolvedValue('/Users/ako/Zotero/library.bib');
		const fresh = {
			key: 'new',
			line: 1,
			item: { type: 'book', title: 'Just imported' },
			files: []
		};
		importing.previewImport.mockResolvedValue({
			fileName: 'library.bib',
			total: 1,
			fresh: [fresh],
			known: [],
			repeated: [],
			unreadable: []
		});
		importing.importEntries.mockImplementation(async () => {
			projectSources.mockResolvedValue([before, added]);
			return { added: ['erti:new'], skipped: 0 };
		});
		const view = render(MetadataEditor);
		await view.findByText('Already here');

		// Opened from the keyboard, as bits-ui's menu opens in jsdom (primitives.test.ts).
		view.getByRole('button', { name: /^Add/ }).focus();
		await userEvent.keyboard('{Enter}');
		// Opening from the keyboard lands on the first item; this is the third.
		await view.findByText('Import a bibliography…');
		await userEvent.keyboard('{ArrowDown}{ArrowDown}');
		await userEvent.keyboard('{Enter}');

		expect(pickFile).toHaveBeenCalledWith(
			expect.objectContaining({
				filters: [{ name: 'BibTeX, RIS or CSL-JSON', extensions: ['bib', 'bibtex', 'ris', 'json'] }]
			})
		);
		await userEvent.click(
			await view.findByRole('checkbox', { name: 'Also add them to this project' })
		);
		await userEvent.click(view.getByRole('button', { name: 'Import 1' }));

		expect(await view.findByText('Imported just now')).toBeTruthy();
		expect(successToast).toHaveBeenCalledWith(
			'Imported 1 source into your library and this project.'
		);
		expect(view.getByText('Just imported')).toBeTruthy();
		expect(view.queryByText('Already here')).toBeNull();

		// The closed dialog gives the page its pointer back once it has gone.
		await vi.waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'));
		await userEvent.click(view.getByRole('button', { name: 'Clear filter' }));
		expect(view.getByText('Already here')).toBeTruthy();
		expect(view.queryByText('Imported just now')).toBeNull();
	});
});

/** A listed source: a ready work with no file, unless told otherwise. */
function row(fields: Record<string, unknown>) {
	return {
		sha256: 'id',
		file_name: '',
		path: null,
		file_sha256: null,
		csl_json: null,
		zotero_type: null,
		doi: null,
		resolved_via: null,
		state: 'ready',
		last_error: null,
		file_state: null,
		file_error: null,
		...fields
	};
}
