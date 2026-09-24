import { afterEach, beforeEach } from 'vitest';

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
