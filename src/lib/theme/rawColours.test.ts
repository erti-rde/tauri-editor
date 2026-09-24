import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

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

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.(svelte|ts|css)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
	});
}

/** Comments are prose, and may name a colour to explain why it was removed. */
function withoutComments(source: string): string {
	return source
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

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
