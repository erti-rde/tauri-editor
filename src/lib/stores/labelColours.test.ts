import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LABEL_COLOURS, defaultColourFor } from './labelColours';

describe('label colours', () => {
	// M6-8 AC-1: the picker offers the colours a new library starts with, so
	// the two can't drift apart.
	it("M6-8 AC-1: are the eight defaults' own, in their order", () => {
		const rust = readFileSync(join(process.cwd(), 'src-tauri/src/db/queries.rs'), 'utf8');
		const block = rust.slice(rust.indexOf('pub const DEFAULT_LABELS'));
		const defaults = [
			...block.slice(0, block.indexOf('];')).matchAll(/\("([^"]+)", "[^"]+", "([^"]+)"\)/g)
		].map(([, id, colour]) => ({ labelId: id, value: colour }));

		expect(defaults).toHaveLength(8);
		expect(LABEL_COLOURS.map(({ labelId, value }) => ({ labelId, value }))).toEqual(defaults);
	});

	it('gives a default label its colour back, and nothing for one of your own', () => {
		expect(defaultColourFor('evidence')).toBe('145 50% 55%');
		expect(defaultColourFor('my-own')).toBeUndefined();
	});
});
