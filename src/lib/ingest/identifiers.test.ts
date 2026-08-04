import { describe, expect, it } from 'vitest';

import { findArxivId, findDoi, findIdentifier } from './identifiers';

describe('finding a DOI', () => {
	it('finds one printed in a page footer', () => {
		expect(findDoi('Downloaded from journals.org. DOI: 10.1029/2019JC015123 on 3 March.')).toBe(
			'10.1029/2019jc015123'
		);
	});

	it('finds one written as a URL', () => {
		expect(findDoi('Available at https://doi.org/10.1038/s41586-020-2649-2')).toBe(
			'10.1038/s41586-020-2649-2'
		);
	});

	it('does not swallow the sentence punctuation after it', () => {
		expect(findDoi('See 10.1000/abc123.')).toBe('10.1000/abc123');
		expect(findDoi('See 10.1000/abc123, and also')).toBe('10.1000/abc123');
	});

	it('keeps a closing parenthesis that the DOI itself opened', () => {
		// DOIs legitimately contain balanced parentheses.
		expect(findDoi('ref 10.1000/foo(bar) here')).toBe('10.1000/foo(bar)');
		// But not one belonging to the surrounding sentence.
		expect(findDoi('(see 10.1000/plain)')).toBe('10.1000/plain');
	});

	it('returns null rather than guessing', () => {
		// A wrong DOI is worse than none: it yields confidently incorrect metadata.
		expect(findDoi('No identifier anywhere in this text.')).toBeNull();
		expect(findDoi('Version 10.2 of the software')).toBeNull();
		expect(findDoi('10.1000/')).toBeNull();
	});

	it('takes the first DOI when several appear', () => {
		expect(findDoi('10.1111/first and later 10.2222/second')).toBe('10.1111/first');
	});
});

describe('finding an arXiv id', () => {
	it('finds the modern form', () => {
		expect(findArxivId('arXiv:1706.03762v7 [cs.CL] 2 Aug 2023')).toBe('1706.03762');
	});

	it('finds it in a URL', () => {
		expect(findArxivId('https://arxiv.org/abs/2005.14165')).toBe('2005.14165');
	});

	it('finds the pre-2007 form', () => {
		expect(findArxivId('arXiv:math.GT/0309136')).toBe('math.GT/0309136');
	});

	it('ignores text with no identifier', () => {
		expect(findArxivId('Published in Nature, 2020.')).toBeNull();
	});
});

describe('resolution order', () => {
	it('trusts the PDF metadata dictionary over the page text', () => {
		const hit = findIdentifier({ doi: '10.1000/from-metadata' }, 'page says 10.2000/from-text');

		expect(hit).toEqual({ kind: 'doi', value: '10.1000/from-metadata', source: 'metadata' });
	});

	it('falls back to the page text', () => {
		const hit = findIdentifier({}, 'Journal of Things. doi:10.2000/from-text');

		expect(hit).toEqual({ kind: 'doi', value: '10.2000/from-text', source: 'text' });
	});

	it('prefers a DOI to an arXiv id when both are present', () => {
		// A published DOI resolves to the version of record.
		const hit = findIdentifier({}, 'arXiv:1706.03762 later published as 10.1000/vor');

		expect(hit?.kind).toBe('doi');
	});

	it('uses the arXiv id when there is no DOI', () => {
		const hit = findIdentifier({}, 'arXiv:2010.11929v2 [cs.CV]');

		expect(hit).toEqual({ kind: 'arxiv', value: '2010.11929', source: 'text' });
	});

	it('reports nothing when the document identifies itself nowhere', () => {
		expect(findIdentifier(undefined, 'A scanned page with no identifier.')).toBeNull();
	});
});
