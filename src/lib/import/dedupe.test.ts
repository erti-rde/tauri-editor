import { describe, expect, it } from 'vitest';

import { dedupe, normalise, titleKeyOf, type Known } from './dedupe';
import type { ImportEntry } from './types';

const entry = (key: string, item: Record<string, unknown>): ImportEntry => ({
	key,
	line: 1,
	item: { type: 'book', ...item },
	files: []
});

const rawls = {
	title: 'Justice as Fairness',
	author: [{ family: 'Rawls', given: 'John' }],
	issued: { 'date-parts': [[1958]] }
};

describe('what the library has already', () => {
	// M1b-9 AC-4: DOI first, however it's written.
	it('is matched by DOI first, however the DOI is written', () => {
		const library: Known[] = [
			{ id: 'w1', csl: { title: 'Other', DOI: 'https://doi.org/10.2307/2182612' } }
		];
		const { known, fresh } = dedupe(library, [entry('a', { title: 'X', DOI: '10.2307/2182612' })]);
		expect(known).toEqual([expect.objectContaining({ match: { by: 'doi', id: 'w1' } })]);
		expect(fresh).toEqual([]);
	});

	// M1b-9 AC-4
	it('then by title, year and first author, normalised', () => {
		const library: Known[] = [{ id: 'w2', csl: rawls }];
		const incoming = entry('a', {
			title: 'JUSTICE AS FAIRNESS.',
			author: [{ family: 'Rawls', given: 'J.' }],
			issued: { 'date-parts': [[1958, 4]] }
		});
		expect(dedupe(library, [incoming]).known).toEqual([
			expect.objectContaining({ match: { by: 'title', id: 'w2' } })
		]);
	});

	// M1b-9 AC-4
	it('not by title when the year or the first author differs', () => {
		const library: Known[] = [{ id: 'w2', csl: rawls }];
		const later = entry('a', { ...rawls, issued: { 'date-parts': [[1971]] } });
		const other = entry('b', { ...rawls, author: [{ family: 'Daniels' }] });
		expect(dedupe(library, [later, other]).fresh.map((e) => e.key)).toEqual(['a', 'b']);
	});

	// M1b-9 AC-4
	it('not by title when both have DOIs and they differ', () => {
		const library: Known[] = [{ id: 'w2', csl: { ...rawls, DOI: '10.5555/one' } }];
		const { fresh } = dedupe(library, [entry('a', { ...rawls, DOI: '10.5555/two' })]);
		expect(fresh.map((e) => e.key)).toEqual(['a']);
	});

	// M1b-9 AC-4
	it('by title when only one of the two has a DOI', () => {
		const library: Known[] = [{ id: 'w2', csl: rawls }];
		const { known } = dedupe(library, [entry('a', { ...rawls, DOI: '10.5555/two' })]);
		expect(known).toHaveLength(1);
	});

	it('a source with no details yet matches nothing', () => {
		const { fresh } = dedupe([{ id: 'w3', csl: null }], [entry('a', rawls)]);
		expect(fresh).toHaveLength(1);
	});

	// M1b-9 AC-4
	it('a DOI is compared whole, a final full stop and all', () => {
		const library: Known[] = [{ id: 'w1', csl: { title: 'A', DOI: '10.5555/foo.' } }];
		const { fresh, known } = dedupe(library, [
			entry('a', { title: 'B', DOI: '10.5555/foo' }),
			entry('b', { title: 'C', DOI: 'https://doi.org/10.5555/FOO.' })
		]);
		expect(fresh.map((e) => e.key)).toEqual(['a']);
		expect(known.map((k) => k.entry.key)).toEqual(['b']);
	});

	it('two entries in the file with one title but different DOIs are both imported', () => {
		const { fresh, repeated } = dedupe(
			[],
			[entry('a', { ...rawls, DOI: '10.5555/one' }), entry('b', { ...rawls, DOI: '10.5555/two' })]
		);
		expect(fresh.map((e) => e.key)).toEqual(['a', 'b']);
		expect(repeated).toEqual([]);
	});

	it('an entry listed twice in the file is imported once', () => {
		const { fresh, repeated } = dedupe([], [entry('a', rawls), entry('b', { ...rawls })]);
		expect(fresh.map((e) => e.key)).toEqual(['a']);
		expect(repeated).toEqual([expect.objectContaining({ of: 'a' })]);
	});

	it('normalises accents, case, markup and punctuation away', () => {
		expect(normalise('Übermensch & <i>Co.</i>')).toBe('ubermenschco');
		expect(normalise('übermensch & co')).toBe('ubermenschco');
		expect(titleKeyOf({ title: '' })).toBeNull();
	});

	// M1b-9 AC-6: matching a 10k import against a 10k library stays linear.
	it('ten thousand against ten thousand in well under a second', () => {
		const library: Known[] = Array.from({ length: 10_000 }, (_, i) => ({
			id: `w${i}`,
			csl: { title: `Work ${i}`, DOI: `10.5555/${i}` }
		}));
		const incoming = Array.from({ length: 10_000 }, (_, i) =>
			entry(`e${i}`, { title: `Work ${i + 5000}` })
		);
		const started = performance.now();
		const { known, fresh } = dedupe(library, incoming);
		expect(performance.now() - started).toBeLessThan(1000);
		expect([known.length, fresh.length]).toEqual([5000, 5000]);
	});
});
