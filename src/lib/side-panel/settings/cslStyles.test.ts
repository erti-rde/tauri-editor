import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Guards the CSL style index that ships in the app bundle and feeds the style
 * dropdown in Settings.svelte.
 *
 * These assertions are offline: they catch a malformed or truncated
 * regeneration. Whether the URLs still resolve upstream is a question about the
 * outside world, so it lives in `pnpm csl:check` (run on a schedule in CI)
 * rather than in the unit test suite.
 */

const RAW_BASE = 'https://raw.githubusercontent.com/citation-style-language/styles/master/';

const styles: { name: string; download_url: string }[] = JSON.parse(
	readFileSync(path.resolve(process.cwd(), 'src-tauri/resources/csl/cslStyles.json'), 'utf8')
);

const fileNameOf = (style: { download_url: string }) =>
	style.download_url.slice(style.download_url.lastIndexOf('/') + 1);

// Must match the ordering the generator applies (scripts/csl-styles.js).
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

describe('cslStyles.json', () => {
	it('lists the full set of independent upstream styles', () => {
		// The index was once built from a paginated API and silently stopped at
		// 1000 entries, so everything alphabetically after "h" was missing.
		// citation-style-language/styles has published >2500 independent styles
		// since 2021; anything near 1000 means the regeneration was truncated.
		expect(styles.length).toBeGreaterThan(2000);
	});

	it('only points at root-level .csl files in the styles repo', () => {
		for (const style of styles) {
			expect(style.download_url.startsWith(RAW_BASE)).toBe(true);
			expect(fileNameOf(style)).toMatch(/\.csl$/);
			// Dependent styles carry no formatting rules of their own, so
			// citeproc-js cannot build an engine from one.
			expect(style.download_url.slice(RAW_BASE.length)).not.toContain('/');
		}
	});

	it('gives every entry a non-empty, unique display name', () => {
		for (const style of styles) {
			expect(style.name.trim()).not.toBe('');
		}

		// saveSettings() resolves the chosen style by name, so duplicates would
		// make one of the entries unreachable.
		expect(new Set(styles.map((style) => style.name)).size).toBe(styles.length);
		expect(new Set(styles.map(fileNameOf)).size).toBe(styles.length);
	});

	it('is sorted by display name for the settings dropdown', () => {
		const sorted = [...styles].sort((a, b) => collator.compare(a.name, b.name));
		expect(styles.map((style) => style.name)).toEqual(sorted.map((style) => style.name));
	});

	it.each([
		'apa.csl',
		'chicago-author-date.csl',
		'chicago-notes-bibliography.csl',
		'harvard-cite-them-right.csl',
		'ieee.csl',
		'modern-language-association.csl',
		'nature.csl',
		'nlm-citation-sequence.csl',
		'science.csl'
	])('includes the widely used style %s', (fileName) => {
		expect(styles.some((style) => fileNameOf(style) === fileName)).toBe(true);
	});
});
