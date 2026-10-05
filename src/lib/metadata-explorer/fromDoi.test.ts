import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	sourceForDoi: vi.fn(),
	addSourceFromDoi: vi.fn(),
	addToProject: vi.fn(),
	networkAllowed: vi.fn(),
	lookupDoi: vi.fn()
}));
vi.mock('$lib/stores/db', () => ({
	sourceForDoi: mocks.sourceForDoi,
	addSourceFromDoi: mocks.addSourceFromDoi,
	addToProject: mocks.addToProject
}));
vi.mock('$lib/stores/consent', () => ({ networkAllowed: mocks.networkAllowed }));
vi.mock('$lib/ingest/resolve', () => ({ lookupDoi: mocks.lookupDoi }));

import type { AugmentedZoteroSchema } from './adapterCslZotero';
import { addFromDoi } from './fromDoi';

const schema = {
	cslToZoteroTypeMap: new Map([
		['article-journal', 'journalArticle'],
		['book', 'book']
	])
} as unknown as AugmentedZoteroSchema;

const PAPER = {
	type: 'article-journal',
	title: 'Deep learning',
	DOI: '10.1038/nature14539',
	reference: [{ key: 'ref1' }]
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.sourceForDoi.mockResolvedValue(null);
	mocks.networkAllowed.mockResolvedValue(true);
	mocks.lookupDoi.mockResolvedValue({ csl: PAPER, via: 'manual', doi: PAPER.DOI });
});

function added() {
	const [id, json, zoteroType] = mocks.addSourceFromDoi.mock.calls[0];
	return { id, csl: JSON.parse(json), zoteroType };
}

describe('addFromDoi', () => {
	// M1b-6 AC-1
	it('looks the DOI up and adds it as a work with no file', async () => {
		const result = await addFromDoi('https://doi.org/10.1038/nature14539', schema);

		expect(mocks.lookupDoi).toHaveBeenCalledWith('10.1038/nature14539');
		const { id, csl, zoteroType } = added();
		expect(id).toMatch(/^erti:[0-9a-f-]{36}$/);
		expect(csl).toMatchObject({ id, title: 'Deep learning', zotero_type: 'journalArticle' });
		expect(csl).not.toHaveProperty('reference');
		expect(zoteroType).toBe('journalArticle');
		expect(result).toEqual({ kind: 'added', id, title: 'Deep learning' });
	});

	// M1b-6 AC-1
	it('keeps a record of a kind the form doesn’t know as a document', async () => {
		mocks.lookupDoi.mockResolvedValue({
			csl: { type: 'posted-content', title: ['A preprint'] },
			via: 'manual',
			doi: '10.1101/x.1'
		});

		await addFromDoi('10.1101/x.1', schema);

		expect(added().csl).toMatchObject({
			type: 'document',
			title: 'A preprint',
			DOI: '10.1101/x.1',
			zotero_type: 'document'
		});
	});

	// M1b-6 AC-2
	it('with lookups off, asks nothing and hands the DOI on to be entered by hand', async () => {
		mocks.networkAllowed.mockResolvedValue(false);

		expect(await addFromDoi('doi:10.1038/nature14539', schema)).toEqual({
			kind: 'by-hand',
			doi: '10.1038/nature14539'
		});
		expect(mocks.lookupDoi).not.toHaveBeenCalled();
		expect(mocks.addSourceFromDoi).not.toHaveBeenCalled();
	});

	// M1b-6 AC-2
	it('hands it on unasked when the details are to be typed anyway', async () => {
		expect(await addFromDoi('10.1038/nature14539', schema, { lookUp: false })).toEqual({
			kind: 'by-hand',
			doi: '10.1038/nature14539'
		});
		expect(mocks.lookupDoi).not.toHaveBeenCalled();
	});

	// M1b-6 AC-3
	it('opens a DOI the library has already, before anything is looked up', async () => {
		mocks.sourceForDoi.mockResolvedValue('erti:lecun');

		for (const allowed of [true, false]) {
			mocks.networkAllowed.mockResolvedValue(allowed);
			expect(await addFromDoi('10.1038/NATURE14539', schema)).toEqual({
				kind: 'existing',
				id: 'erti:lecun'
			});
		}
		expect(mocks.sourceForDoi).toHaveBeenCalledWith('10.1038/nature14539');
		expect(mocks.addToProject).toHaveBeenCalledWith('erti:lecun');
		expect(mocks.lookupDoi).not.toHaveBeenCalled();
		expect(mocks.addSourceFromDoi).not.toHaveBeenCalled();
	});

	// M1b-6 AC-3
	it('opens a source the library has under the DOI doi.org answers with', async () => {
		mocks.lookupDoi.mockResolvedValue({ csl: PAPER, via: 'manual', doi: '10.1038/NATURE.14539' });
		mocks.sourceForDoi.mockImplementation(async (doi: string) =>
			doi === '10.1038/NATURE.14539' ? 'erti:lecun' : null
		);

		expect(await addFromDoi('10.1038/nature14539', schema)).toEqual({
			kind: 'existing',
			id: 'erti:lecun'
		});
		expect(mocks.addSourceFromDoi).not.toHaveBeenCalled();
	});

	it('says when doi.org has nothing for it', async () => {
		mocks.lookupDoi.mockResolvedValue(null);
		expect(await addFromDoi('10.1000/missing', schema)).toEqual({
			kind: 'not-found',
			doi: '10.1000/missing'
		});
	});

	it('says when what was typed isn’t a DOI', async () => {
		expect(await addFromDoi('nature14539', schema)).toEqual({ kind: 'not-a-doi' });
		expect(mocks.sourceForDoi).not.toHaveBeenCalled();
	});
});
