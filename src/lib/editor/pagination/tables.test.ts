import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The table rules the pagination library injects, and why ours must outrank
 * them.
 *
 * It writes a stylesheet at runtime so a table can be split across a page
 * boundary, and the central rule is `table { display: contents }` — which
 * removes the table box altogether. With no box there is no `table-layout:
 * fixed` and no colgroup, so the measured width went to zero, columns collapsed
 * onto their content, and TipTap's column resizing had nothing to drag.
 *
 * These assertions read both stylesheets. They are here because the failure was
 * invisible to every other kind of test: the markup is unchanged, the extension
 * mounts, and nothing throws — the table is simply flat.
 */

const ours = readFileSync('src/global.css', 'utf8');
const theirs = readFileSync('node_modules/tiptap-pagination-plus/dist/PaginationPlus.js', 'utf8');

describe('the rules the library injects', () => {
	it('still flattens the table box, which is why ours exist', () => {
		// If this ever stops being true the overrides can go. Until then, removing
		// them puts the squashed table straight back.
		expect(theirs).toContain('display: contents');
	});
});

describe('our table rules', () => {
	const scoped = (declaration: string) =>
		new RegExp(`\\.manuscript\\.rm-with-pagination table[^{]*\\{[^}]*${declaration}`, 's');

	it('gives the table its box back', () => {
		expect(ours).toMatch(scoped('display: table'));
	});

	it('keeps the fixed layout that column widths depend on', () => {
		// TipTap resizes columns by writing widths into the colgroup, which only
		// has an effect under `table-layout: fixed`.
		expect(ours).toMatch(scoped('table-layout: fixed'));
	});

	it('fills the text column rather than shrinking to the content', () => {
		expect(ours).toMatch(scoped('width: 100%'));
	});

	it('outranks the injected rules on specificity', () => {
		// Two classes and a type beats one class and a type. Worth pinning: a
		// well-meaning simplification to `.manuscript table` would lose silently,
		// and the only symptom is a flat table.
		expect(ours).toContain('.manuscript.rm-with-pagination table');
	});

	it('does not break words mid-character', () => {
		// The injected `word-break: break-all` is unreadable in prose and wrong for
		// a column of author names or measurements.
		expect(ours).toMatch(
			/\.manuscript\.rm-with-pagination table tr t[dh][^{]*\{[^}]*word-break: normal/s
		);
	});
});
