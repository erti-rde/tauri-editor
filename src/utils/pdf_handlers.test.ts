import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only what Enter DOI reaches: the rest of the module reads PDFs.
const mocks = vi.hoisted(() => ({
	lookupDoi: vi.fn(),
	resolveMetadata: vi.fn(),
	networkAllowed: vi.fn(async () => true),
	setSourceMetadata: vi.fn(async () => {})
}));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {} }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn() }));
vi.mock('$lib/ingest/extract', () => ({}));
vi.mock('$lib/ingest/chunk', () => ({}));
vi.mock('$lib/ingest/pipeline', () => ({}));
vi.mock('$lib/statusFooter/StatusFooter.svelte', () => ({}));
vi.mock('$lib/toast/Toast.svelte', () => ({}));
vi.mock('$lib/ingest/resolve', async (real) => ({
	...(await real<typeof import('$lib/ingest/resolve')>()),
	lookupDoi: mocks.lookupDoi,
	resolveMetadata: mocks.resolveMetadata
}));
vi.mock('$lib/stores/consent', () => ({
	networkAllowed: mocks.networkAllowed,
	getMailto: vi.fn(async () => undefined)
}));
vi.mock('$lib/stores/db', () => ({ setSourceMetadata: mocks.setSourceMetadata }));
vi.mock('$lib/metadata-explorer/adapterCslZotero', () => ({
	augmentSchema: vi.fn(async () => ({ cslToZoteroTypeMap: new Map([['article', 'preprint']]) }))
}));

import { applyManualDoi } from './pdf_handlers';

beforeEach(() => vi.clearAllMocks());

describe('Enter DOI on a failed PDF (applyManualDoi)', () => {
	it('asks doi.org about a DOI alone', async () => {
		mocks.lookupDoi.mockResolvedValue({
			csl: { type: 'article', title: ['Deep learning'], reference: [1, 2] },
			via: 'manual',
			doi: '10.1038/nature14539'
		});

		const saved = await applyManualDoi('sha-1', 'https://doi.org/10.1038/Nature14539');

		expect(mocks.lookupDoi).toHaveBeenCalledWith('10.1038/nature14539');
		expect(mocks.resolveMetadata).not.toHaveBeenCalled();
		expect(saved).toMatchObject({ id: 'sha-1', title: 'Deep learning' });
		expect(saved).not.toHaveProperty('reference');
	});

	// M1b-6 review: what isn't a DOI went to doi.org as one, and an arXiv id
	// pasted here, which used to resolve, came back not found.
	it('reads anything else as a PDF’s text is, so an arXiv id still resolves', async () => {
		mocks.resolveMetadata.mockResolvedValue({
			resolved: { csl: { type: 'article', title: 'Attention' }, via: 'pdf-arxiv', doi: null }
		});

		await applyManualDoi('sha-1', 'arXiv:1706.03762');

		expect(mocks.lookupDoi).not.toHaveBeenCalled();
		expect(mocks.resolveMetadata).toHaveBeenCalledWith(
			expect.objectContaining({ text: 'arXiv:1706.03762', allowNetwork: true })
		);
	});

	it('asks nothing with lookups off', async () => {
		mocks.networkAllowed.mockResolvedValue(false);

		await expect(applyManualDoi('sha-1', '10.1038/nature14539')).rejects.toThrow(
			'Online lookups are turned off'
		);
		expect(mocks.lookupDoi).not.toHaveBeenCalled();
		expect(mocks.resolveMetadata).not.toHaveBeenCalled();
	});
});
