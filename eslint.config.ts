import prettier from 'eslint-config-prettier';
import js from '@eslint/js';
import { includeIgnoreFile } from '@eslint/compat';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';
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
		// One way to call Rust (ADR 011). Generated commands check names, arguments
		// and results at compile time; a hand-written invoke checks none of them.
		files: ['src/**/*.{ts,svelte}'],
		ignores: ['src/lib/ipc/**', 'src/**/*.test.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: '@tauri-apps/api/core',
							importNames: ['invoke'],
							message: "Call Rust through `commands` from '$lib/ipc' (ADR 011)."
						}
					]
				}
			]
		}
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
