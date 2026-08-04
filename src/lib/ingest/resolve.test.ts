import { describe, expect, it, vi } from 'vitest';

import { resolveMetadata } from './resolve';

const APA_PAPER = {
	title: 'Deep Residual Learning for Image Recognition',
	type: 'paper-conference',
	DOI: '10.1109/cvpr.2016.90'
};

/** A fetch stub that answers by URL and records what was asked for. */
function stubFetch(routes: Record<string, unknown>, status = 200) {
	const calls: string[] = [];
	const impl = vi.fn(async (url: string | URL) => {
		const href = url.toString();
		calls.push(href);
		const match = Object.keys(routes).find((key) => href.includes(key));
		if (!match) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
		return {
			ok: status < 400,
			status,
			json: async () => routes[match]
		} as unknown as Response;
	});
	return { impl: impl as unknown as typeof fetch, calls };
}

describe('offline resolution', () => {
	it('makes no network call at all when consent is withheld', async () => {
		const { impl, calls } = stubFetch({});

		const result = await resolveMetadata({
			text: 'arXiv:1706.03762v7 [cs.CL]',
			allowNetwork: false,
			fetchImpl: impl
		});

		expect(calls).toEqual([]);
		// The identifier is still recorded, so a later online run can resolve it.
		expect(result?.via).toBe('pdf-arxiv');
	});

	it('reports nothing when there is no identifier and no network', async () => {
		const { impl } = stubFetch({});

		const result = await resolveMetadata({
			text: 'A scanned page with nothing to go on.',
			allowNetwork: false,
			fetchImpl: impl
		});

		expect(result).toBeNull();
	});
});

describe('identifier-first resolution', () => {
	it('resolves a DOI found in the text without searching', async () => {
		const { impl, calls } = stubFetch({ 'doi.org': APA_PAPER });

		const result = await resolveMetadata({
			text: 'Published version: https://doi.org/10.1109/cvpr.2016.90',
			allowNetwork: true,
			fetchImpl: impl
		});

		expect(result?.via).toBe('pdf-doi');
		expect(result?.csl.title).toBe(APA_PAPER.title);
		// Crossref's search endpoint is never touched.
		expect(calls.some((c) => c.includes('api.crossref.org'))).toBe(false);
	});

	it('resolves an arXiv id through its DataCite DOI', async () => {
		const { impl, calls } = stubFetch({ 'doi.org': APA_PAPER });

		const result = await resolveMetadata({
			text: 'arXiv:1512.03385v1 [cs.CV]',
			allowNetwork: true,
			fetchImpl: impl
		});

		expect(result?.via).toBe('pdf-arxiv');
		expect(calls[0]).toContain('10.48550/arXiv.1512.03385');
	});

	it('prefers the PDF metadata dictionary over the page text', async () => {
		const { impl, calls } = stubFetch({ 'doi.org': APA_PAPER });

		await resolveMetadata({
			info: { doi: '10.1000/authoritative' },
			text: 'somewhere in the body 10.2000/scraped',
			allowNetwork: true,
			fetchImpl: impl
		});

		expect(calls[0]).toContain('10.1000/authoritative');
	});
});

describe('falling back to search', () => {
	it('uses the bibliographic field and the polite pool', async () => {
		const { impl, calls } = stubFetch({
			'api.crossref.org': { message: { items: [{ DOI: '10.1000/found' }] } },
			'doi.org': APA_PAPER
		});

		const result = await resolveMetadata({
			info: { Title: 'Deep Residual Learning', Author: 'He' },
			text: 'no identifier here',
			allowNetwork: true,
			mailto: 'erti@example.org',
			fetchImpl: impl
		});

		expect(result?.via).toBe('crossref');
		const search = calls.find((c) => c.includes('api.crossref.org'))!;
		expect(search).toContain('query.bibliographic=');
		expect(search).toContain('mailto=erti%40example.org');
	});

	it('ignores a producer-generated title that is really a filename', async () => {
		// "Microsoft Word - final_v3.doc" as a title is why searching on it failed.
		const { impl, calls } = stubFetch({
			'api.crossref.org': { message: { items: [{ DOI: '10.1000/found' }] } },
			'doi.org': APA_PAPER
		});

		await resolveMetadata({
			info: { Title: 'Microsoft Word - final_v3.doc' },
			text: 'Coastal erosion under rising sea levels. Alice Smith. Journal of Coastal Research.',
			allowNetwork: true,
			fetchImpl: impl
		});

		const search = calls.find((c) => c.includes('api.crossref.org'))!;
		// URLSearchParams encodes spaces as '+', which decodeURIComponent leaves alone.
		const readable = decodeURIComponent(search).replace(/\+/g, ' ');

		expect(readable).not.toContain('Microsoft');
		expect(readable).toContain('Coastal erosion');
	});
});

describe('failure is reported, never invented', () => {
	it('returns null rather than empty metadata when nothing resolves', async () => {
		// Storing '{}' is what left 50% of the old database looking resolved and
		// never retried.
		const { impl } = stubFetch({});

		const result = await resolveMetadata({
			text: 'nothing identifiable at all',
			allowNetwork: true,
			fetchImpl: impl
		});

		expect(result).toBeNull();
	});

	it('rejects a record with no usable title', async () => {
		const { impl } = stubFetch({ 'doi.org': { type: 'article-journal' } });

		const result = await resolveMetadata({
			text: '10.1000/untitled',
			allowNetwork: true,
			fetchImpl: impl
		});

		expect(result).toBeNull();
	});

	it('retries a rate-limited request', async () => {
		let attempts = 0;
		const impl = vi.fn(async () => {
			attempts++;
			if (attempts < 2) return { ok: false, status: 429, json: async () => ({}) } as Response;
			return { ok: true, status: 200, json: async () => APA_PAPER } as unknown as Response;
		}) as unknown as typeof fetch;

		const result = await resolveMetadata({
			text: '10.1000/flaky',
			allowNetwork: true,
			fetchImpl: impl
		});

		expect(attempts).toBeGreaterThan(1);
		expect(result?.csl.title).toBe(APA_PAPER.title);
	});

	it('does not retry a 404', async () => {
		let attempts = 0;
		const impl = vi.fn(async () => {
			attempts++;
			return { ok: false, status: 404, json: async () => ({}) } as Response;
		}) as unknown as typeof fetch;

		await resolveMetadata({ text: '10.1000/missing', allowNetwork: true, fetchImpl: impl });

		// One attempt for the DOI, one for the Crossref search — neither repeated.
		expect(attempts).toBeLessThanOrEqual(2);
	});
});
