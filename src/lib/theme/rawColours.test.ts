import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceFiles, withoutComments } from './sourceScan';

/**
 * No colour is written into a class name.
 *
 * Every colour comes from a semantic token, so a palette is one block of values
 * and every component follows it. A raw Tailwind colour ignores the palette: the
 * explorer's `text-neutral-900` rendered file names at about 1.1:1 on every dark
 * palette, invisible, and nothing caught it, because the contrast test checks
 * tokens and this was not one.
 */
const RAW_COLOUR =
	/\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide|placeholder|decoration|shadow|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?(?:\/\d+)?\b/g;

const SRC = join(process.cwd(), 'src');

describe('colours come from tokens', () => {
	it('uses no raw Tailwind colour class anywhere in src', () => {
		const found = sourceFiles(SRC).flatMap((file) =>
			[...withoutComments(readFileSync(file, 'utf8')).matchAll(RAW_COLOUR)].map(
				(m) => `${relative(process.cwd(), file)}: ${m[0]}`
			)
		);
		expect(found).toEqual([]);
	});
});
