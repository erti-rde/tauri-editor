import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceFiles, withoutComments } from './sourceScan';

/**
 * One token source (M1c-1, ADR 010).
 *
 * The bits-ui starter template left a second token set in `global.css`, in raw
 * `rgba` that no palette controlled. These keep it from coming back, in any of
 * the files tokens are declared in. What the tokens compute to is checked in a
 * browser (`e2e/tokens.spec.ts`).
 */

const root = process.cwd();
const read = (path: string) => withoutComments(readFileSync(join(root, path), 'utf8'));
const globalCss = read('src/global.css');
const TOKEN_FILES = ['src/global.css', 'src/lib/theme/tokens.css', 'src/lib/theme/palettes.css'];

/** Each starter token, as a declaration, so a later token that merely shares a prefix passes. */
const STARTER = [
	/--shadow-(?:mini|mini-inset|popover|kbd|btn|card|date-field-focus)\s*:/,
	/--radius-(?:card(?:-lg|-sm)?|input|button|\d+px)\s*:/,
	/--dark(?:-\d+)?\s*:/,
	/--border(?:-input|-card)?(?:-hover)?\s*:/,
	/--(?:background|foreground|muted|destructive|tertiary|contrast)(?:-[a-z]+)?\s*:/,
	/--bits-(?:accent|line)(?:-[a-z]+)?\s*:/,
	/--text-xxs\s*:/,
	/--spacing-input(?:-sm)?\s*:/,
	/--breakpoint-desktop\s*:/,
	/--animate-(?:caret-blink|scale-in|scale-out|fade-in|fade-out|enter-from-left|enter-from-right|exit-to-left|exit-to-right)\s*:/
];

// M1c-1 AC-1
describe('the starter template', () => {
	for (const pattern of STARTER) {
		it(`is gone from the token files: ${pattern.source}`, () => {
			const declaring = TOKEN_FILES.filter((file) => pattern.test(read(file)));
			expect(declaring).toEqual([]);
		});
	}

	it('left no use of its popover shadow; overlays use shadow-overlay', () => {
		const users = sourceFiles(join(root, 'src'))
			.filter((file) => withoutComments(readFileSync(file, 'utf8')).includes('shadow-popover'))
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
