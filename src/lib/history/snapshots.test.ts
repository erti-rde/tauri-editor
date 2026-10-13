import { describe, expect, it, vi } from 'vitest';

import type { Snapshot, Trigger } from '$lib/ipc/bindings';

import { createSnapshots } from './snapshots';

const snapshot = (trigger: Trigger, words: number | null): Snapshot => ({
	file: '2026-10-13T10-00-00Z.erti.json',
	takenAt: 0,
	trigger,
	words,
	bytes: 1
});

describe('asking for snapshots', () => {
	// M5-1 AC-2
	it('asks only for a document this session has written', async () => {
		const take = vi.fn(async (_: string, trigger: Trigger, words: number | null) =>
			snapshot(trigger, words)
		);
		const snapshots = createSnapshots(take);

		await snapshots.closing('/p/A.erti.json', 'close');
		await snapshots.writing('/p/A.erti.json');
		expect(take).not.toHaveBeenCalled();

		snapshots.written('/p/A.erti.json', 12);
		await snapshots.writing('/p/A.erti.json');
		expect(take).toHaveBeenLastCalledWith('/p/A.erti.json', 'writing', 12);
		expect(snapshots.pending('/p/A.erti.json')).toBe(false);

		// Taken: closing now has nothing new to keep.
		await snapshots.closing('/p/A.erti.json', 'close');
		expect(take).toHaveBeenCalledTimes(1);
	});

	// M5-1 AC-2
	it('keeps asking while writing until Rust takes one, and on close whatever it says', async () => {
		const take = vi.fn(async () => null);
		const snapshots = createSnapshots(take);

		snapshots.written('/p/A.erti.json', 3);
		await snapshots.writing('/p/A.erti.json');
		// Too soon after the last: still owed.
		expect(snapshots.pending('/p/A.erti.json')).toBe(true);

		snapshots.written('/p/A.erti.json', 4);
		await snapshots.closing('/p/A.erti.json', 'quit');
		expect(take).toHaveBeenLastCalledWith('/p/A.erti.json', 'quit', 4);
		// The newest snapshot already held it.
		expect(snapshots.pending('/p/A.erti.json')).toBe(false);
	});

	// M5-1 AC-2
	it('keeps a save that lands while a snapshot is taken', async () => {
		let answer: (s: Snapshot) => void = () => {};
		const take = vi
			.fn(async (_: string, trigger: Trigger, words: number | null) => snapshot(trigger, words))
			.mockImplementationOnce(() => new Promise<Snapshot>((resolve) => (answer = resolve)));
		const snapshots = createSnapshots(take);

		snapshots.written('/p/A.erti.json', 1);
		const asked = snapshots.writing('/p/A.erti.json');
		snapshots.written('/p/A.erti.json', 2);
		answer(snapshot('writing', 1));
		await asked;

		expect(snapshots.pending('/p/A.erti.json')).toBe(true);
		await snapshots.closing('/p/A.erti.json', 'close');
		expect(take).toHaveBeenLastCalledWith('/p/A.erti.json', 'close', 2);
	});

	// M5-1 AC-2
	it('says when one fails, and keeps it owed', async () => {
		const failed = new Error('disk full');
		const onError = vi.fn();
		const snapshots = createSnapshots(async () => {
			throw failed;
		}, onError);

		snapshots.written('/p/A.erti.json', 1);
		await snapshots.closing('/p/A.erti.json', 'close');
		await snapshots.closing('/p/A.erti.json', 'close');

		// Said once, as the first; heard every time.
		expect(onError.mock.calls).toEqual([
			['/p/A.erti.json', failed, true],
			['/p/A.erti.json', failed, false]
		]);
		expect(snapshots.pending('/p/A.erti.json')).toBe(true);
	});

	it('keeps each document to itself', async () => {
		const take = vi.fn(async (_: string, trigger: Trigger, words: number | null) =>
			snapshot(trigger, words)
		);
		const snapshots = createSnapshots(take);

		snapshots.written('/p/A.erti.json', 1);
		snapshots.written('/p/B.erti.json', 2);
		await snapshots.closing('/p/A.erti.json', 'close');

		expect(take).toHaveBeenCalledWith('/p/A.erti.json', 'close', 1);
		expect(snapshots.pending('/p/B.erti.json')).toBe(true);
	});
});
