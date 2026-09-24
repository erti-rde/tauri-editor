import { error } from '@sveltejs/kit';

import type { PageLoad } from './$types';

/**
 * The app on a fake backend, for tests and screenshots (M1a-1).
 *
 * Only a `--mode harness` build has anything here. `import.meta.env.MODE` is
 * replaced at build time, so in the app Erti ships this branch is dead code and
 * the fake backend, its fixtures and the fixture PDF never reach the bundle
 * (`pnpm e2e` checks the production build for them).
 *
 * The fake goes in during `load`, before any component mounts: the layout reads
 * the settings store in its own `onMount`, and would reach for Tauri first.
 */
export const load: PageLoad = async ({ url }) => {
	if (import.meta.env.MODE === 'harness') {
		const { boot } = await import('$lib/harness/boot');
		boot(url);
		return;
	}
	error(404, 'Not found');
};
