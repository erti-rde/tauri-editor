import prettier from 'eslint-config-prettier';
import js from '@eslint/js';
import { includeIgnoreFile } from '@eslint/compat';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';
/**
 * Imports with one owner each.
 *
 * - `invoke`: one way to call Rust (ADR 011). Generated commands check names,
 *   arguments and results at compile time; a hand-written invoke checks none.
 * - the settings store: one module declares every key, its type and default
 *   (M1a-11). A key spelt differently in two places failed quietly.
 * - the log plugin: one logger decides what may be written (M1a-12).
 * - pdf.js: one module opens every PDF, with eval off (M6-3).
 *
 * A file may import what it owns and nothing else on the list. One rule entry
 * per group of files, because a later `no-restricted-imports` replaces an
 * earlier one rather than adding to it.
 */
const PDFJS_MESSAGE = "Open a PDF with `openPdf` from '$lib/pdfjs' (M6-3).";
/** pdf.js itself or one of its builds, as an esquery regex: `.` stands for `/`. */
const PDFJS_BUILD = '/^pdfjs-dist(.(legacy.)?build.|$)/';

function restrictedImports() {
	type Owned = { paths: object[]; patterns?: object[] };
	const invoke = {
		name: '@tauri-apps/api/core',
		importNames: ['invoke'],
		message: "Call Rust through `commands` from '$lib/ipc' (ADR 011)."
	};
	const store = {
		name: '@tauri-apps/plugin-store',
		message: "Read and write settings through '$lib/settings' (M1a-11)."
	};
	const logPlugin = {
		name: '@tauri-apps/plugin-log',
		message: "Log through '$lib/log', which keeps what the user wrote out of the file (M1a-12)."
	};
	// Every build pdf.js ships, minified or not, and spelt with or without
	// `.mjs`: each is a `getDocument` that `openPdf` doesn't set. The viewer
	// (`web/`) and the types aren't, so they stay open.
	const pdfjs: Owned = {
		paths: [{ name: 'pdfjs-dist', message: PDFJS_MESSAGE }],
		patterns: [
			{ group: ['pdfjs-dist/build/*', 'pdfjs-dist/legacy/build/*'], message: PDFJS_MESSAGE }
		]
	};
	const rule = (...owned: (object | Owned)[]) => {
		const all = owned.map((o): Owned => ('paths' in o ? (o as Owned) : { paths: [o] }));
		const paths = all.flatMap((o) => o.paths);
		const patterns = all.flatMap((o) => o.patterns ?? []);
		return { rules: { 'no-restricted-imports': ['error', { paths, patterns }] as const } };
	};
	return [
		{
			files: ['src/**/*.{ts,svelte}'],
			ignores: [
				'src/lib/ipc/**',
				'src/lib/settings/**',
				'src/lib/log.ts',
				'src/lib/pdfjs.ts',
				'src/**/*.test.ts'
			],
			...rule(invoke, store, logPlugin, pdfjs)
		},
		{
			files: ['src/lib/ipc/**/*.ts'],
			ignores: ['src/**/*.test.ts'],
			...rule(store, logPlugin, pdfjs)
		},
		{
			files: ['src/lib/settings/**/*.ts'],
			ignores: ['src/**/*.test.ts'],
			...rule(invoke, logPlugin, pdfjs)
		},
		{ files: ['src/lib/log.ts'], ...rule(invoke, store, pdfjs) },
		{ files: ['src/lib/pdfjs.ts'], ...rule(invoke, store, logPlugin) },
		{
			// `no-restricted-imports` doesn't see `import()`, and a paper opened that
			// way would have eval on. A template literal has no `value`, so it's
			// matched by its first part: `pdfjs-dist/build/${name}` is refused too.
			files: ['src/**/*.{ts,svelte}'],
			ignores: ['src/lib/pdfjs.ts', 'src/**/*.test.ts'],
			rules: {
				'no-restricted-syntax': [
					'error',
					{ selector: `ImportExpression[source.value=${PDFJS_BUILD}]`, message: PDFJS_MESSAGE },
					{
						selector: `ImportExpression > TemplateLiteral.source[quasis.0.value.cooked=${PDFJS_BUILD}]`,
						message: PDFJS_MESSAGE
					}
				] as const
			}
		}
	];
}

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

export default ts.config(
	includeIgnoreFile(gitignorePath),
	{
		// `includeIgnoreFile` only reads the root .gitignore, which does not cover the
		// vendored pdf.js bundles or the Rust build output. Without these, `eslint .`
		// reports ~2400 errors from third-party and generated code and is unusable in CI.
		ignores: [
			'static/pdfjs/**',
			'src-tauri/target/**',
			'src-tauri/gen/**',
			// Agent worktrees hold full nested checkouts of this repo.
			'.claude/**',
			// Generated from the Rust commands (ADR 011).
			'src/lib/ipc/bindings.ts'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node
			}
		},
		rules: {
			// Allow a leading underscore to mark a binding as intentionally discarded —
			// used for props that must be destructured out of `...restProps` but not rendered.
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_'
				}
			]
		}
	},
	{
		// The real-app journeys (M1a-2) run under WebdriverIO's Mocha.
		files: ['e2e-app/**/*.mjs'],
		languageOptions: { globals: { ...globals.mocha } }
	},
	...restrictedImports(),
	{
		// One logger (M1a-12). `console` reaches a devtools window nobody has
		// open, and nothing checks what it's given; `$lib/log` writes the file
		// and keeps manuscript text out of it.
		files: ['src/**/*.{ts,svelte}'],
		ignores: ['src/**/*.test.ts'],
		rules: { 'no-console': 'error' }
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		ignores: ['eslint.config.js', 'svelte.config.js'],

		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	}
);
