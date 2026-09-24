import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach } from 'vitest';

/**
 * Outlive the timers an unmounted overlay leaves behind.
 *
 * bits-ui's body-scroll-lock restores `document.body`'s style on a 24ms
 * `setTimeout` rather than synchronously, so a same-tick destroy/create does
 * not thrash the page. If a test file finishes inside that window, the timer
 * fires after jsdom has been torn down, `document` is undefined, and it throws
 * — outside any test, so every assertion still passes and the run exits 1
 * regardless. "402 passed" next to a red gate is this.
 *
 * It is a race rather than a flake: won three times locally in a row, lost on
 * CI. This waits it out once per file, which is where teardown happens, so the
 * cost is ~30ms per file and not per test. Global rather than in the one file
 * that hit it, because the next Dialog, Popover or Select test would rediscover
 * this the same expensive way.
 */
afterAll(async () => {
	await new Promise((resolve) => setTimeout(resolve, 30));
});

/**
 * Clear that same lock between tests, rather than waiting it out.
 *
 * The 24ms restore above is late enough that the *next* test starts with
 * `pointer-events: none` still on the body, and every click it makes is
 * swallowed — a test that passes alone and fails in the file, which is the
 * worst kind. Waiting the window out per test would cost ~20 seconds a run;
 * clearing it costs nothing, and the timer restoring it to the same value
 * afterwards is harmless.
 */
afterEach(() => {
	if (typeof document !== 'undefined') document.body.style.pointerEvents = '';
});

/**
 * jsdom does not implement scrollIntoView, and several components call it to
 * bring something they have just changed into view — the marks panel revealing
 * a highlight the reader has only now made, for one.
 *
 * A no-op rather than a guard in the components: the method exists in every
 * browser, and `?.()` at each call site would be test-shaped code in production
 * that also hides a genuine typo.
 */
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = function scrollIntoView() {};
}

/**
 * jsdom does not implement matchMedia, and the appearance layer asks it which
 * theme the OS is in. Stubbed as "light" so components under test render the
 * branch a user on a light machine sees.
 *
 * The listeners are kept rather than dropped on the floor. `initialise()`
 * registers a `change` handler so the app follows the OS at sunset instead of
 * only at launch; with the earlier no-op stub that handler could never fire, so
 * the one behaviour worth testing here was the one behaviour untestable.
 * `setSystemTheme()` drives it.
 */
type Listener = (event: MediaQueryListEvent) => void;

const queries = new Set<{ matches: boolean; listeners: Set<Listener> }>();

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
	Object.defineProperty(window, 'matchMedia', {
		writable: true,
		value: (query: string) => {
			const state = { matches: false, listeners: new Set<Listener>() };
			queries.add(state);

			return {
				get matches() {
					return state.matches;
				},
				media: query,
				onchange: null,
				addEventListener: (_: string, listener: Listener) => state.listeners.add(listener),
				removeEventListener: (_: string, listener: Listener) => state.listeners.delete(listener),
				addListener: (listener: Listener) => state.listeners.add(listener),
				removeListener: (listener: Listener) => state.listeners.delete(listener),
				dispatchEvent: () => false
			};
		}
	});
}

/** Flip the OS preference and notify everyone who asked to be told. */
export function setSystemTheme(dark: boolean) {
	for (const state of queries) {
		state.matches = dark;
		for (const listener of state.listeners) {
			listener({ matches: dark } as MediaQueryListEvent);
		}
	}
}

/** Forget the queries a previous test registered. */
export function resetSystemTheme() {
	queries.clear();
}
