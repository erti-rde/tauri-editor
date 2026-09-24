import { describe, expect, it } from 'vitest';

import {
	checkSize,
	guardCslItem,
	guardCslItems,
	guardDocument,
	guardEnvelope,
	guardMark,
	guardSidecar,
	LimitError,
	LIMITS,
	ShapeError
} from './index';

/** JSON as it arrives: `__proto__` is an own key after JSON.parse, which is the attack. */
const hostile = (json: string) => JSON.parse(json);

function nested(depth: number) {
	let node: Record<string, unknown> = { type: 'text', text: 'deep' };
	for (let i = 0; i < depth; i++) node = { type: 'blockquote', content: [node] };
	return { type: 'doc', content: [node] };
}

// M1b-10 AC-2: CSL-JSON, from a lookup, an import or a manuscript's envelope.
describe('a CSL item', () => {
	it('keeps what CSL defines, as the kind of value CSL expects', () => {
		const item = guardCslItem({
			id: 'vaswani2017',
			type: 'paper-conference',
			title: 'Attention Is All You Need',
			volume: 30,
			author: [{ family: 'Vaswani', given: 'Ashish' }, { literal: 'Google Brain' }],
			issued: { 'date-parts': [[2017, 6, 12]] },
			DOI: '10.48550/arXiv.1706.03762',
			abstract: 'The dominant sequence transduction models…',
			zotero_type: 'conferencePaper'
		});
		expect(item).toEqual({
			id: 'vaswani2017',
			type: 'paper-conference',
			title: 'Attention Is All You Need',
			volume: '30',
			author: [{ family: 'Vaswani', given: 'Ashish' }, { literal: 'Google Brain' }],
			issued: { 'date-parts': [[2017, 6, 12]] },
			DOI: '10.48550/arXiv.1706.03762',
			abstract: 'The dominant sequence transduction models…',
			zotero_type: 'conferencePaper'
		});
	});

	it('drops fields CSL does not have, including prototype keys', () => {
		const item = guardCslItem(
			hostile(
				'{"type":"book","title":"T","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"onload":"alert(1)","custom":{"x":1}}'
			)
		);
		expect(item).toEqual({ type: 'book', title: 'T' });
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(Object.getPrototypeOf(item)).toBe(Object.prototype);
	});

	it('keeps a script in a title as text; sanitising happens where text becomes HTML', () => {
		const title = '<script>alert(1)</script><img src=x onerror=alert(2)>';
		expect(guardCslItem({ type: 'book', title }).title).toBe(title);
	});

	it('takes the first of a list where CSL expects one value, as Crossref sends them', () => {
		const item = guardCslItem({
			type: 'article-journal',
			title: ['Attention Is All You Need'],
			ISSN: ['0028-0836', '1476-4687'],
			'container-title': []
		});
		expect(item).toEqual({
			type: 'article-journal',
			title: 'Attention Is All You Need',
			ISSN: '0028-0836'
		});
	});

	it('renders an unknown type as a generic document', () => {
		expect(guardCslItem({ type: 'weird<type>' }).type).toBe('document');
		expect(guardCslItem({}).type).toBe('document');
	});

	it('drops values of the wrong kind', () => {
		const item = guardCslItem({
			type: 'book',
			title: { toString: 'x' },
			volume: Number.NaN,
			author: 'Vaswani',
			issued: '2017',
			editor: [{ family: 42 }, null, 'x']
		});
		expect(item).toEqual({ type: 'book' });
	});

	it('cuts a string that runs to megabytes', () => {
		const item = guardCslItem({
			type: 'book',
			title: 'x'.repeat(5_000_000),
			note: 'y'.repeat(5_000_000)
		});
		expect((item.title as string).length).toBe(LIMITS.field);
		expect((item.note as string).length).toBe(LIMITS.longField);
	});

	// M1b-10 AC-3
	it('refuses a name list of a million people, saying the limit', () => {
		const author = Array.from({ length: 1_000_000 }, () => ({ family: 'X' }));
		expect(() => guardCslItem({ type: 'book', author })).toThrow(
			/at most 10,000 people as author; this one lists 1,000,000/
		);
	});

	it('keeps partial dates, ranges and literal dates, and drops broken ones', () => {
		expect(guardCslItem({ issued: { 'date-parts': [[1962]] } }).issued).toEqual({
			'date-parts': [[1962]]
		});
		expect(guardCslItem({ issued: { 'date-parts': [['2017', '6'], [2018]] } }).issued).toEqual({
			'date-parts': [[2017, 6], [2018]]
		});
		expect(guardCslItem({ issued: { literal: 'Spring 2019', circa: true } }).issued).toEqual({
			literal: 'Spring 2019',
			circa: true
		});
		expect(guardCslItem({ issued: { 'date-parts': [['soon']] } })).not.toHaveProperty('issued');
		expect(
			guardCslItem({ issued: { 'date-parts': [[2017, 1, 1, 9, 9]], season: 2 } }).issued
		).toEqual({
			'date-parts': [[2017, 1, 1]],
			season: 2
		});
	});

	it('refuses something that is not an item', () => {
		for (const bad of [null, 'a string', 42, [], undefined]) {
			expect(() => guardCslItem(bad)).toThrow(ShapeError);
		}
	});
});

// M1b-10 AC-2, AC-3: a CSL-JSON import.
describe('a list of CSL items to import', () => {
	it('skips entries that are not items and says how many', () => {
		const { items, skipped } = guardCslItems([
			{ type: 'book', title: 'A' },
			'junk',
			null,
			{ title: 'B' }
		]);
		expect(items.map((i) => i.title)).toEqual(['A', 'B']);
		expect(skipped).toBe(2);
	});

	it('refuses a file with more entries than an import allows, saying so', () => {
		const huge = Array.from({ length: LIMITS.importEntries + 1 }, () => ({}));
		expect(() => guardCslItems(huge)).toThrow(LimitError);
		expect(() => guardCslItems(huge)).toThrow(
			/at most 50,000 sources at once; this file has 50,001/
		);
	});

	it('refuses the import whole when one entry breaks a limit', () => {
		const author = Array.from({ length: LIMITS.names + 1 }, () => ({ family: 'X' }));
		expect(() => guardCslItems([{ title: 'ok' }, { author }])).toThrow(LimitError);
	});

	it('refuses something that is not a list', () => {
		expect(() => guardCslItems({ items: [] })).toThrow(ShapeError);
	});
});

// M1b-10 AC-2: the manuscript's document and envelope.
describe('a manuscript', () => {
	it('keeps a document as ProseMirror reads it', () => {
		const doc = {
			type: 'doc',
			content: [
				{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
						{
							type: 'citation',
							attrs: { id: 'a'.repeat(64), label: '(Vaswani, 2017)', noteIndex: 0 }
						}
					]
				}
			]
		};
		expect(guardDocument(doc)).toEqual(doc);
	});

	it('drops unknown fields and prototype keys from nodes, marks and attributes', () => {
		const doc = guardDocument(
			hostile(
				'{"type":"doc","onclick":"x","content":[{"type":"paragraph","attrs":{"__proto__":{"polluted":1},"align":"left"},"content":[{"type":"text","text":"t","marks":[{"type":"link","attrs":{"href":"https://x","constructor":{}},"extra":1}]}]}]}'
			)
		);
		expect(doc).toEqual({
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					attrs: { align: 'left' },
					content: [
						{ type: 'text', text: 't', marks: [{ type: 'link', attrs: { href: 'https://x' } }] }
					]
				}
			]
		});
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	// M1b-10 AC-3
	it('refuses nesting deeper than the limit, saying so', () => {
		expect(() => guardDocument(nested(LIMITS.depth - 2))).not.toThrow();
		expect(() => guardDocument(nested(10_000))).toThrow(/nest at most 200 levels/);
	});

	it('refuses deeply nested attribute values too', () => {
		let value: unknown = 'leaf';
		for (let i = 0; i < 1000; i++) value = { next: value };
		expect(() =>
			guardDocument({ type: 'doc', content: [{ type: 'paragraph', attrs: { value } }] })
		).toThrow(LimitError);
	});

	it('refuses something that is not a document', () => {
		expect(() => guardDocument({ type: 'paragraph' })).toThrow(ShapeError);
		expect(() => guardDocument({ type: 'doc', content: ['text'] })).toThrow(ShapeError);
		expect(() => guardDocument([])).toThrow(ShapeError);
	});

	it('guards the sources a manuscript carries', () => {
		const envelope = guardEnvelope(
			hostile(
				'{"format":1,"savedWith":"1.0.0","sources":{"aaa":{"type":"book","title":"<b>T</b>","x":1},"__proto__":{"type":"book"},"bad":"not a source"}}'
			)
		);
		expect(envelope).toEqual({
			format: 1,
			savedWith: '1.0.0',
			sources: { aaa: { type: 'book', title: '<b>T</b>' } }
		});
	});

	it('reads a damaged format number as format 0', () => {
		expect(guardEnvelope({ format: 'one' }).format).toBe(0);
		expect(guardEnvelope({ format: -1 }).format).toBe(0);
		expect(() => guardEnvelope(null)).toThrow(ShapeError);
	});

	// M1b-10 AC-3
	it('refuses a manuscript carrying more sources than the limit', () => {
		const sources = Object.fromEntries(
			Array.from({ length: LIMITS.manuscriptSources + 1 }, (_, i) => [`s${i}`, { type: 'book' }])
		);
		expect(() => guardEnvelope({ format: 1, sources })).toThrow(/at most 20,000 sources/);
	});
});

// M1b-10 AC-2: an annotation sidecar.
describe('a sidecar', () => {
	const mark = { id: 'm1', sha256: 'a'.repeat(64), kind: 'highlight', page: 3, quote: 'q' };

	it('keeps each mark, with every field present and of its kind', () => {
		const sidecar = guardSidecar({ format: 'erti-annotations', version: 1, annotations: [mark] });
		expect(sidecar.annotations[0]).toMatchObject({ ...mark, note: null, char_start: null });
		expect(Object.keys(sidecar.annotations[0])).toHaveLength(17);
	});

	it('drops unknown fields and prototype keys', () => {
		const [kept] = guardSidecar(
			hostile(
				`{"format":"erti-annotations","version":1,"annotations":[{"id":"m1","sha256":"a","page":1,"__proto__":{"polluted":1},"html":"<script>"}]}`
			)
		).annotations;
		expect(kept).not.toHaveProperty('html');
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it('refuses a mark that cannot be drawn, and with it the whole file', () => {
		expect(() => guardMark({ id: 'm1', page: 1 })).toThrow(ShapeError);
		expect(() => guardMark({ id: 'm1', sha256: 'a', page: -1 })).toThrow(ShapeError);
		expect(() =>
			guardSidecar({ format: 'erti-annotations', version: 1, annotations: [mark, { id: 'x' }] })
		).toThrow(ShapeError);
	});

	it('refuses a file that is not a sidecar', () => {
		expect(() => guardSidecar({ format: 'other', version: 1, annotations: [] })).toThrow(
			ShapeError
		);
		expect(() => guardSidecar({ format: 'erti-annotations', annotations: [] })).toThrow(ShapeError);
		expect(() => guardSidecar(null)).toThrow(ShapeError);
	});

	// M1b-10 AC-3
	it('refuses more marks than the limit, saying so', () => {
		const annotations = { length: LIMITS.sidecarMarks + 1 } as unknown as unknown[];
		expect(() =>
			guardSidecar({
				format: 'erti-annotations',
				version: 1,
				annotations: Array.from(annotations, () => mark)
			})
		).toThrow(/at most 100,000 marks/);
	});
});

// M1b-10 AC-3: files too big to parse.
describe('file sizes', () => {
	it('lets a file under the limit through', () => {
		expect(() => checkSize(1024, 'manuscriptBytes')).not.toThrow();
	});

	it('refuses a manuscript over the limit, naming it', () => {
		expect(() => checkSize(60 * 1024 * 1024, 'manuscriptBytes')).toThrow(
			'A manuscript can be at most 50 MB; this one is 60 MB.'
		);
	});

	it('refuses a bibliography over the limit, naming it', () => {
		const refusal = (() => {
			try {
				checkSize(21 * 1024 * 1024, 'bibliographyBytes');
			} catch (error) {
				return error;
			}
		})();
		expect(refusal).toBeInstanceOf(LimitError);
		expect((refusal as LimitError).limit).toBe('bibliographyBytes');
		expect((refusal as LimitError).message).toContain('at most 20 MB');
	});
});
