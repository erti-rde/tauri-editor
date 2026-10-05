import { normalise } from '$lib/theme/theme';

import { defaultFixture } from './fixture';
import { installFakeBackend } from './install';

/**
 * Start the harness from its URL, so a journey or a person can ask for a
 * particular world without code:
 *
 * - `?consent=unasked` — a first launch: the privacy question is shown.
 * - `?consent=granted` — online lookups on. A journey answers what's asked
 *   with `page.route`, so nothing leaves the machine.
 * - `?recents=none` — nothing opened before: the landing screen is empty.
 * - `?theme=night-owl&density=comfortable` — an appearance, as if chosen in
 *   Settings. The catalogue (M1c-5) is screenshotted in each.
 */
export function boot(url: URL) {
	const fixture = defaultFixture();
	const settings = fixture.stores['settings-store.json'];

	if (url.searchParams.get('consent') === 'unasked') delete settings.allowNetworkLookups;
	if (url.searchParams.get('consent') === 'granted') settings.allowNetworkLookups = true;
	if (url.searchParams.get('recents') === 'none') delete settings.recentProjects;

	const theme = url.searchParams.get('theme');
	const density = url.searchParams.get('density');
	if (theme || density) {
		// Through `normalise`, as a hand-edited settings file would be: a palette
		// that doesn't exist falls back rather than rendering unstyled.
		const appearance = normalise({
			theme: (theme ?? undefined) as never,
			density: (density ?? undefined) as never
		});
		settings.appearance = appearance;
		// And before the first paint, as app.html does from localStorage.
		if (appearance.theme !== 'system') document.documentElement.dataset.theme = appearance.theme;
	}

	return installFakeBackend(fixture);
}
