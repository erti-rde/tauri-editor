import { error } from '@sveltejs/kit';

import type { PageLoad } from './$types';

/**
 * Every primitive in every state, for screenshots and the rendered-contrast
 * check (M1c-5, ADR 010).
 *
 * The catalogue itself lives in `$lib/harness` and is imported only here,
 * behind the same build-time branch as `/harness`: in the app Erti ships, the
 * import is dead code, and `scripts/check-harness-excluded.mjs` checks the
 * build agrees. The fake backend goes in too, because the root layout reads the
 * stored appearance from it, which is how `?theme=` and `?density=` arrive.
 */
export const load: PageLoad = async ({ url }) => {
	if (import.meta.env.MODE === 'harness') {
		const { boot } = await import('$lib/harness/boot');
		boot(url);
		const { default: Catalogue } = await import('$lib/harness/Catalogue.svelte');
		return { Catalogue };
	}
	error(404, 'Not found');
};
