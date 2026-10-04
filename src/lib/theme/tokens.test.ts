import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * One token source (M1c-1, ADR 010).
 *
 * The bits-ui starter template left a second token set in `global.css`, in raw
 * `rgba` that no palette controlled. These keep it from coming back. What the
 * tokens compute to is checked in a browser (`e2e/tokens.spec.ts`).
 */

const root = process.cwd();
const globalCss = readFileSync(join(root, 'src/global.css'), 'utf8');

const STARTER = [
	/--shadow-(?:mini|popover|kbd|btn|card|date-field-focus)\b/,
	/--radius-(?:card|input|button|\d+px)\b/,
	/--dark(?:-\d+)?\b/,
	/--border(?:-input|-card)?(?:-hover)?\s*:/,
	/--(?:background|foreground|muted|destructive|tertiary|contrast)(?:-[a-z]+)?\s*:/,
	/--animate-(?:caret-blink|scale-in|fade-in|enter-from-left)\b/
];

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.(svelte|ts|css)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
	});
}

// M1c-1 AC-1
describe('the starter template', () => {
	for (const pattern of STARTER) {
		it(`is gone from global.css: ${pattern.source}`, () => {
			expect(globalCss).not.toMatch(pattern);
		});
	}

	it('left no use of its popover shadow; overlays use shadow-overlay', () => {
		const users = sourceFiles(join(root, 'src'))
			.filter((file) => readFileSync(file, 'utf8').includes('shadow-popover'))
			.map((file) => relative(root, file));
		expect(users).toEqual([]);
	});
});

// M1c-1 AC-2: every step is derived, so nothing is fixed in px.
describe('the type scale', () => {
	for (const step of ['caption', 'small', 'body', 'title', 'heading', 'display']) {
		it(`derives text-${step} from --ui-size`, () => {
			const declared = globalCss.match(new RegExp(`--text-${step}:\\s*([^;]+);`))?.[1];
			expect(declared).toContain('var(--ui-size)');
		});
	}
});
