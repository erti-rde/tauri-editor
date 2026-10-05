import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';

const { projectSources, retryIngest, attachPdf } = vi.hoisted(() => ({
	projectSources: vi.fn(),
	retryIngest: vi.fn(),
	attachPdf: vi.fn()
}));

vi.mock('$lib/stores/db', () => ({ projectSources, setMetadataOverride: vi.fn() }));
vi.mock('$utils/pdf_handlers', () => ({ retryIngest, applyManualDoi: vi.fn() }));
vi.mock('./adapterCslZotero', () => ({ augmentSchema: vi.fn(async () => null) }));
vi.mock('./attach', () => ({ attachPdf }));
vi.mock('$lib/toast/Toast.svelte', () => ({ errorToast: vi.fn(), successToast: vi.fn() }));

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
