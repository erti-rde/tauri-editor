import { defaultFixture } from './fixture';
import { installFakeBackend } from './install';

/**
 * Start the harness from its URL, so a journey or a person can ask for a
 * particular world without code:
 *
 * - `?consent=unasked` — a first launch: the privacy question is shown.
 * - `?recents=none` — nothing opened before: the landing screen is empty.
 */
export function boot(url: URL) {
	const fixture = defaultFixture();
	const settings = fixture.stores['settings-store.json'];

	if (url.searchParams.get('consent') === 'unasked') delete settings.allowNetworkLookups;
	if (url.searchParams.get('recents') === 'none') delete settings.recentProjects;

	return installFakeBackend(fixture);
}
