import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reading the source tree for the guard tests (ADR 010): every rule that says
 * "nothing in src does this" walks the same files, the same way.
 */

/** Every Svelte, TS and CSS file under `dir`, tests excepted. */
export function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.(svelte|ts|css)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
	});
}

/** Comments are prose, and may name what they explain was removed. */
export function withoutComments(source: string): string {
	return source
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}
