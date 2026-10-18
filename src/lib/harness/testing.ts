import { afterEach, beforeEach, expect, vi } from 'vitest';

import { defaultFixture, type Fixture } from './fixture';
import { installFakeBackend, type FakeBackend } from './install';

/**
 * The fake backend for a vitest file (M1a-1 AC-7).
 *
 * The same fake the browser harness runs on, installed fresh before each test
 * and removed after, in place of `vi.mock` of `@tauri-apps/*` written out again
 * in every file. Returns a getter, since the backend is new for each test:
 *
 *     const backend = useFakeBackend();
 *     it('…', () => { backend().stores.get('settings-store.json') … });
 *
 * Pass a function to change the world for this file:
 * `useFakeBackend(() => ({ ...defaultFixture(), sources: [] }))`.
 */
export function useFakeBackend(fixture: () => Fixture = defaultFixture): () => FakeBackend {
	let backend: FakeBackend | undefined;

	beforeEach(() => {
		backend = installFakeBackend(fixture());
	});

	afterEach(() => {
		backend?.uninstall();
		backend = undefined;
	});

	return () => {
		if (!backend) throw new Error('The fake backend is only installed inside a test.');
		return backend;
	};
}

/**
 * Wait until focus has stopped moving and rests where `settled` says it should.
 *
 * Focus bounces while bits-ui opens a menu: to the content, back to the
 * trigger, inward, then a frame later its focus scope moves it again. A key
 * sent mid-bounce lands on the wrong element: Enter on the menu itself chooses
 * nothing. How many frames the bounce takes depends on load, so this waits
 * until focus has gone two frame callbacks without moving rather than for any
 * one step. A loaded runner stretches each frame, hence the long timeout.
 */
export const focusSettles = (settled: (focused: Element | null) => void) =>
	vi.waitFor(
		async () => {
			const focused = document.activeElement;
			settled(focused);
			let moved = false;
			const onFocusIn = () => (moved = true);
			document.addEventListener('focusin', onFocusIn);
			try {
				for (let frame = 0; frame < 2; frame++) {
					await new Promise(requestAnimationFrame);
				}
			} finally {
				document.removeEventListener('focusin', onFocusIn);
			}
			expect(moved).toBe(false);
			expect(document.activeElement).toBe(focused);
		},
		{ timeout: 10_000 }
	);
