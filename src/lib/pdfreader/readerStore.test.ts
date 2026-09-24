import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

import { readerStore } from './readerStore';

/**
 * The interesting parts are not the reads. They are what happens when the same
 * paper is open twice, and what happens in the moment one reader replaces
 * another in the same pane.
 */

beforeEach(() => readerStore.reset());

const location = { page: 4 };

describe('registering', () => {
	it('holds one reader per pane', () => {
		readerStore.register({ paneId: 'pane-1', path: '/a.pdf', navigate: vi.fn() });
		readerStore.register({ paneId: 'pane-2', path: '/b.pdf', navigate: vi.fn() });

		expect(Object.keys(get(readerStore))).toEqual(['pane-1', 'pane-2']);
	});

	it('publishes the page as the reader scrolls', () => {
		const handle = readerStore.register({ paneId: 'pane-1', path: '/a.pdf', navigate: vi.fn() });

		handle.report({ page: 7, pages: 20 });

		expect(get(readerStore)['pane-1'].page).toBe(7);
		expect(get(readerStore)['pane-1'].pages).toBe(20);
	});

	it('forgets a reader that goes away', () => {
		const handle = readerStore.register({ paneId: 'pane-1', path: '/a.pdf', navigate: vi.fn() });

		handle.release();

		expect(get(readerStore)).toEqual({});
	});
});

describe('replacing a reader in the same pane', () => {
	it('survives the outgoing reader tearing down after the incoming one mounts', () => {
		// Switching papers destroys one reader and creates another in the same
		// pane, and Svelte does not promise which runs first. An unguarded release
		// would delete the entry that had just been created and leave the pane
		// unreachable.
		const outgoing = readerStore.register({ paneId: 'pane-1', path: '/a.pdf', navigate: vi.fn() });
		const incoming = readerStore.register({ paneId: 'pane-1', path: '/b.pdf', navigate: vi.fn() });

		outgoing.release();

		expect(get(readerStore)['pane-1']).toBeDefined();
		expect(get(readerStore)['pane-1'].path).toBe('/b.pdf');
		expect(incoming).toBeDefined();
	});

	it('ignores a stale report from the reader that was replaced', () => {
		const outgoing = readerStore.register({ paneId: 'pane-1', path: '/a.pdf', navigate: vi.fn() });
		readerStore.register({ paneId: 'pane-1', path: '/b.pdf', navigate: vi.fn() });

		// A page event still in flight when the tab changed.
		outgoing.report({ page: 99 });

		expect(get(readerStore)['pane-1'].page).toBe(1);
	});
});

describe('jumping to a place', () => {
	it('calls the reader showing that paper', () => {
		const navigate = vi.fn();
		readerStore.register({ paneId: 'pane-1', path: '/a.pdf', navigate });

		expect(readerStore.navigate('/a.pdf', location)).toBe(true);
		expect(navigate).toHaveBeenCalledWith(location);
	});

	it('says no when the paper is not open, rather than guessing', () => {
		// The caller's cue to open a tab. Opening one is workspaceStore's job:
		// which pane a paper belongs in is not something this store can know.
		readerStore.register({ paneId: 'pane-1', path: '/a.pdf', navigate: vi.fn() });

		expect(readerStore.navigate('/elsewhere.pdf', location)).toBe(false);
	});

	it('prefers the pane being looked at when the paper is open twice', () => {
		// split() duplicates a PDF into both panes on purpose, so this is a
		// arrangement the researcher asked for, not an edge case.
		const left = vi.fn();
		const right = vi.fn();
		readerStore.register({ paneId: 'pane-1', path: '/a.pdf', navigate: left });
		readerStore.register({ paneId: 'pane-2', path: '/a.pdf', navigate: right });

		readerStore.navigate('/a.pdf', location, 'pane-2');

		expect(right).toHaveBeenCalledWith(location);
		expect(left).not.toHaveBeenCalled();
	});

	it('still jumps when the preferred pane shows something else', () => {
		const other = vi.fn();
		readerStore.register({ paneId: 'pane-1', path: '/a.pdf', navigate: other });
		readerStore.register({ paneId: 'pane-2', path: '/b.pdf', navigate: vi.fn() });

		expect(readerStore.navigate('/a.pdf', location, 'pane-2')).toBe(true);
		expect(other).toHaveBeenCalledWith(location);
	});

	it('knows whether a paper is on screen', () => {
		readerStore.register({ paneId: 'pane-1', path: '/a.pdf', navigate: vi.fn() });

		expect(readerStore.isOpen('/a.pdf')).toBe(true);
		expect(readerStore.isOpen('/b.pdf')).toBe(false);
	});
});
