/**
 * Lets Node run the app's TypeScript modules as they stand (M4-4).
 *
 * Node strips types itself, but resolves `import './normalise'` only with its
 * extension, which the app's modules leave off as Vite and TypeScript expect.
 * This tries `.ts` when a relative import without one isn't found.
 *
 * Usage: node --import ./scripts/eval/resolve-ts.mjs <script>
 */

import { registerHooks } from 'node:module';

registerHooks({
	resolve(specifier, context, nextResolve) {
		try {
			return nextResolve(specifier, context);
		} catch (error) {
			if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
				return nextResolve(`${specifier}.ts`, context);
			}
			throw error;
		}
	}
});
