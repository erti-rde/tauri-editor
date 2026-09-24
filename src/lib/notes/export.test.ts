import { describe, expect, it } from 'vitest';

import { parseSidecar, toMarkdown, toSidecar } from './export';
import type { Annotation, AnnotationLabel } from '$lib/stores/db';

const labels: AnnotationLabel[] = [
	{ id: 'claim', name: 'Claim', colour: '45 95% 62%', position: 0, enabled: true }
];

const sources = [
	{ sha256: 'sha-1', title: 'Smith 2020, A Study' },
	{ sha256: 'sha-2', title: 'Jones 2019, Another' }
];

function mark(overrides: Partial<Annotation> = {}): Annotation {
	return {
		id: 'a1',
		sha256: 'sha-1',
		kind: 'highlight',
		label_id: 'claim',
		page: 4,
		rects: '[]',
		quote: 'the effect was strongest',
		prefix: null,
		suffix: null,
		char_start: null,
		char_end: null,
		note: null,
		style: 'fill',
		page_label: null,
		origin: 'erti',
		created_at: '2026-01-01',
		updated_at: '2026-01-01',
		...overrides
	};
}

describe('notes as Markdown', () => {
	it('groups marks under the paper they came from', () => {
		const out = toMarkdown([mark(), mark({ id: 'a2', sha256: 'sha-2', page: 1 })], sources, labels);

		expect(out).toContain('## Smith 2020, A Study');
		expect(out).toContain('## Jones 2019, Another');
	});

	it('puts a paper’s marks in reading order', () => {
		const out = toMarkdown(
			[
				mark({ id: 'late', page: 9, quote: 'later' }),
				mark({ id: 'early', page: 2, quote: 'earlier' })
			],
			sources,
			labels
		);

		expect(out.indexOf('earlier')).toBeLessThan(out.indexOf('later'));
	});

	it('says the label and the page', () => {
		expect(toMarkdown([mark()], sources, labels)).toContain('**Claim · p. 4**');
	});

	it('keeps the paper’s words visibly apart from the reader’s', () => {
		// Run together, which is whose stops being obvious immediately.
		const out = toMarkdown([mark({ note: 'this contradicts Jones' })], sources, labels);

		expect(out).toContain('> the effect was strongest');
		expect(out).toContain('this contradicts Jones');
		expect(out.indexOf('> the effect')).toBeLessThan(out.indexOf('this contradicts'));
	});

	it('flattens a quote that ran over several lines', () => {
		// A blockquote broken by a raw newline stops being a blockquote.
		const out = toMarkdown([mark({ quote: 'over\ntwo lines' })], sources, labels);

		expect(out).toContain('> over two lines');
	});

	it('marks what came from somewhere else', () => {
		expect(toMarkdown([mark({ origin: 'imported' })], sources, labels)).toContain(
			'_Imported from another tool._'
		);
	});

	it('names a paper it has no record of rather than leaving a gap', () => {
		expect(toMarkdown([mark({ sha256: 'missing' })], sources, labels)).toContain('Unknown paper');
	});

	it('produces a document even with nothing to say', () => {
		expect(toMarkdown([], sources, labels)).toContain('# Notes');
	});
});

describe('the sidecar', () => {
	it('round-trips every record', () => {
		const original = [mark(), mark({ id: 'a2', page: 7 })];

		const back = parseSidecar(toSidecar(original));

		expect(back?.annotations).toEqual(original);
	});

	it('keeps the ids, which is what makes re-importing work', () => {
		// An integer id would collide with whatever already holds it on another
		// machine; a uuid is the same record wherever it lands.
		const back = parseSidecar(toSidecar([mark()]));

		expect(back?.annotations[0].id).toBe('a1');
	});

	it('says what it is, so a later reader can tell', () => {
		expect(parseSidecar(toSidecar([]))?.format).toBe('erti-annotations');
		expect(parseSidecar(toSidecar([]))?.version).toBe(1);
	});

	it('refuses a file that is not one of ours', () => {
		expect(parseSidecar('{"format":"something-else","version":1,"annotations":[]}')).toBeNull();
	});

	it('refuses something that is not JSON at all', () => {
		expect(parseSidecar('not json')).toBeNull();
		expect(parseSidecar('')).toBeNull();
	});

	it('refuses a file whose records are missing what a mark needs', () => {
		// Half-importing is worse than refusing: the library would be left in a
		// state nobody chose.
		const broken = '{"format":"erti-annotations","version":1,"annotations":[{"id":"a1"}]}';

		expect(parseSidecar(broken)).toBeNull();
	});
});

describe('the page a citation should say', () => {
	it('uses the number the paper prints, not the sheet', () => {
		// An article beginning on page 843 calls its eleventh sheet 853. Citing
		// "p. 11" points at nothing a reader of the journal can find.
		const out = toMarkdown([mark({ page: 11, page_label: '853' })], sources, labels);

		expect(out).toContain('p. 853');
		expect(out).not.toContain('p. 11');
	});

	it('falls back to the sheet when the paper has not said', () => {
		// True of most PDFs, and it costs nothing to store nothing.
		expect(toMarkdown([mark({ page: 4 })], sources, labels)).toContain('p. 4');
	});

	it('ignores a label that is only whitespace', () => {
		expect(toMarkdown([mark({ page: 4, page_label: '  ' })], sources, labels)).toContain('p. 4');
	});
});
