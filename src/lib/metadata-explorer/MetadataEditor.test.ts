import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';

const { projectSources, retryIngest } = vi.hoisted(() => ({
	projectSources: vi.fn(),
	retryIngest: vi.fn()
}));

vi.mock('$lib/stores/db', () => ({ projectSources, setMetadataOverride: vi.fn() }));
vi.mock('$utils/pdf_handlers', () => ({ retryIngest, applyManualDoi: vi.fn() }));
vi.mock('./adapterCslZotero', () => ({ augmentSchema: vi.fn(async () => null) }));
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
});
