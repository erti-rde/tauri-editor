import { describe, expect, it } from 'vitest';

import { describeAuthors, describeType } from './sourceRows';
import type { CitationItem } from '$lib/stores/citationStore';

const item = (fields: Partial<CitationItem>) => ({ id: 'x', type: '', ...fields }) as CitationItem;

describe('naming the kind of source', () => {
	it('uses the word a researcher would use, not the CSL slug', () => {
		expect(describeType(item({ type: 'article-journal' }))).toBe('Paper');
		expect(describeType(item({ type: 'paper-conference' }))).toBe('Conference');
		// CSL spells preprint "manuscript", which nobody says out loud.
		expect(describeType(item({ type: 'manuscript' }))).toBe('Preprint');
	});

	it('stays readable for a type nobody mapped', () => {
		// A slug with the hyphens taken out beats "Unknown" — CSL has around
		// thirty types and the list here covers the ones that actually turn up.
		expect(describeType(item({ type: 'entry-dictionary' }))).toBe('entry dictionary');
	});

	it('says nothing rather than guessing for an unresolved source', () => {
		// These are the rows the explorer exists to draw attention to.
		expect(describeType(null)).toBe('—');
		expect(describeType(item({ type: '' }))).toBe('—');
	});
});

describe('naming who wrote it', () => {
	it('reads as a citation does, by first author', () => {
		expect(describeAuthors(item({ author: [{ family: 'Smith', given: 'Ada' }] }))).toBe(
			'Smith, Ada'
		);
	});

	it('says et al. rather than filling the column with names', () => {
		const authors = [
			{ family: 'Smith', given: 'Ada' },
			{ family: 'Jones', given: 'Bo' },
			{ family: 'Patel', given: 'Cy' }
		];

		expect(describeAuthors(item({ author: authors }))).toBe('Smith, Ada et al.');
	});

	it('handles an organisation, which has no given name to join', () => {
		// Crossref returns institutional authors in `literal`. Reading only
		// family/given renders these as ", " — a comma and a space.
		expect(
			describeAuthors(item({ author: [{ family: '', given: '', literal: 'World Bank' }] }))
		).toBe('World Bank');
	});

	it('returns nothing when there is nobody to name', () => {
		expect(describeAuthors(null)).toBeNull();
		expect(describeAuthors(item({}))).toBeNull();
		expect(describeAuthors(item({ author: [] }))).toBeNull();
		expect(describeAuthors(item({ author: [{ family: '', given: '' }] }))).toBeNull();
	});
});
