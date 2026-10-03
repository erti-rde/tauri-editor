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
 *
 * A file may import what it owns and nothing else on the list. One rule entry
 * per group of files, because a later `no-restricted-imports` replaces an
 * earlier one rather than adding to it.
 */
function restrictedImports() {
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
	const rule = (...paths: object[]) => ({
		rules: { 'no-restricted-imports': ['error', { paths }] as const }
	});
	return [
		{
			files: ['src/**/*.{ts,svelte}'],
			ignores: ['src/lib/ipc/**', 'src/lib/settings/**', 'src/lib/log.ts', 'src/**/*.test.ts'],
			...rule(invoke, store, logPlugin)
		},
		{ files: ['src/lib/ipc/**/*.ts'], ignores: ['src/**/*.test.ts'], ...rule(store, logPlugin) },
		{
			files: ['src/lib/settings/**/*.ts'],
			ignores: ['src/**/*.test.ts'],
			...rule(invoke, logPlugin)
		},
		{ files: ['src/lib/log.ts'], ...rule(invoke, store) }
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
