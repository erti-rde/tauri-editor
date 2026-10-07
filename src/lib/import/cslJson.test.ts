import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseCslJson } from './cslJson';

const fixture = (name: string) => readFileSync(resolve('src/lib/import/fixtures', name), 'utf8');

describe('CSL-JSON', () => {
	// M1b-9 AC-1, M1b-10: through the same guard as the manuscript envelope.
	it('is read through the shape guard: CSL’s own variables kept, the rest dropped', () => {
		const { entries } = parseCslJson(fixture('zotero.json'));
		expect(entries[0].item).toMatchObject({
			type: 'article-journal',
			title: 'Justice as Fairness',
			issued: { 'date-parts': [[1958, 4]] }
		});
		expect(entries[1].item).not.toHaveProperty('custom');
		expect(entries[1].key).toBe('arendt1958');
	});

	// M1b-9 AC-4
	it('an entry that isn’t a source is listed by its place in the file', () => {
		expect(parseCslJson(fixture('zotero.json')).unreadable).toEqual([
			{ key: 'entry 3', line: null, reason: 'It isn’t a source.' }
		]);
	});

	it('a single item is a list of one', () => {
		expect(parseCslJson('{"type":"book","title":"A"}').entries).toHaveLength(1);
	});

	// M1b-9 AC-4
	it('a file that isn’t JSON is said so, with the line where it stops being JSON', () => {
		const { entries, unreadable } = parseCslJson('[\n  {"title": "A"},\n  oops\n]');
		expect(entries).toEqual([]);
		expect(unreadable).toHaveLength(1);
		expect(unreadable[0].reason).toBe('The file isn’t valid JSON.');
		// Where the engine says, which V8 does.
		expect([3, null]).toContain(unreadable[0].line);
	});
});
