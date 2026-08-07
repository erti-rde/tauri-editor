import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAutosave } from './autosave';

/**
 * The defect being guarded: an edit made while a save was in flight was
 * cancelled and never rescheduled, so it reached disk only if the user happened
 * to type again afterwards. Stop typing at that moment and the work was gone,
 * with nothing on screen to say so.
 */

/** A write whose completion the test controls, so a race can be arranged. */
function controllableWrite() {
	const writes: unknown[] = [];
	let release: (() => void) | null = null;

	let reject: ((error: Error) => void) | null = null;

	const write = vi.fn(async (content: unknown) => {
		writes.push(content);
		await new Promise<void>((resolve, rej) => {
			release = resolve;
			reject = rej;
		});
	});

	return {
		write,
		writes,
		finish() {
			release?.();
			release = null;
			// Let the awaiting write resume before the assertion runs.
			return Promise.resolve().then(() => Promise.resolve());
		},
		fail(error: Error) {
			reject?.(error);
			reject = null;
			return Promise.resolve().then(() => Promise.resolve());
		}
	};
}

/**
 * Track whether a promise has resolved, for asserting that it has *not*.
 *
 * A flag the promise sets itself, read after letting the microtask queue drain.
 * An earlier version raced the promise against `Promise.resolve()`, which
 * reported an already-resolved promise as still pending — so the flush test
 * built on it passed on timing rather than on behaviour, and missed a real bug.
 */
function watch<T>(promise: Promise<T>) {
	const box = { done: false, value: undefined as T | undefined };
	void promise.then((value) => {
		box.done = true;
		box.value = value;
	});
	return box;
}

/** Let every queued microtask run before reading a watcher. */
const drainMicrotasks = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('coalescing edits', () => {
	it('writes once for a burst of typing', async () => {
		const write = vi.fn(async () => {});
		const save = createAutosave({ write, delay: 500 });

		save.schedule(() => 'a');
		save.schedule(() => 'ab');
		save.schedule(() => 'abc');
		await vi.advanceTimersByTimeAsync(500);

		expect(write).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledWith('abc');
	});

	it('reads the content when the save runs, not when it is scheduled', async () => {
		// One write per quiet period rather than one per keystroke, and always the
		// newest document.
		let doc = 'first';
		const write = vi.fn(async () => {});
		const save = createAutosave({ write, delay: 500 });

		save.schedule(() => doc);
		doc = 'second';
		await vi.advanceTimersByTimeAsync(500);

		expect(write).toHaveBeenCalledWith('second');
	});
});

describe('an edit made while a save is in flight', () => {
	it('is written, not dropped', async () => {
		// The defect, exactly. The old code cleared the pending timer and returned
		// without scheduling anything, so this edit was lost.
		const disk = controllableWrite();
		const save = createAutosave({ write: disk.write, delay: 500 });

		save.schedule(() => 'first');
		await vi.advanceTimersByTimeAsync(500);
		expect(disk.writes).toEqual(['first']);

		// Typed while the write is still outstanding.
		save.schedule(() => 'second');
		await disk.finish();

		expect(disk.writes).toEqual(['first', 'second']);
	});

	it('is written even when the user never types again', async () => {
		// The worst case: the edit is the last thing that happens, so nothing
		// later comes along to rescue it.
		const disk = controllableWrite();
		const save = createAutosave({ write: disk.write, delay: 500 });

		save.schedule(() => 'first');
		await vi.advanceTimersByTimeAsync(500);
		save.schedule(() => 'second');
		await disk.finish();
		await disk.finish();

		expect(disk.writes.at(-1)).toBe('second');
		expect(save.hasUnsavedChanges).toBe(false);
	});

	it('does not lose a newer edit when the write it interrupted fails', async () => {
		// The failure path put the *failed* getter back as pending, overwriting
		// the newer one scheduled while the write was outstanding. The retry then
		// wrote older content over newer work — the exact loss this module is for.
		const disk = controllableWrite();
		const save = createAutosave({ write: disk.write, delay: 500, onError: () => {} });

		save.schedule(() => 'first');
		await vi.advanceTimersByTimeAsync(500);

		save.schedule(() => 'second');
		await disk.fail(new Error('disk full'));

		// The retry has to be released before flush can finish, so flush is
		// started rather than awaited — awaiting it here would deadlock the test
		// against the very write it is waiting for.
		const flushed = watch(save.flush());
		await drainMicrotasks();
		await disk.finish();
		await drainMicrotasks();

		expect(flushed.done).toBe(true);
		expect(disk.writes.at(-1)).toBe('second');
		expect(save.hasUnsavedChanges).toBe(false);
	});

	it('never runs two writes at once', async () => {
		let active = 0;
		let maxActive = 0;
		const write = vi.fn(async () => {
			active++;
			maxActive = Math.max(maxActive, active);
			await Promise.resolve();
			active--;
		});
		const save = createAutosave({ write, delay: 500 });

		save.schedule(() => 'a');
		await vi.advanceTimersByTimeAsync(500);
		save.schedule(() => 'b');
		save.schedule(() => 'c');
		await vi.advanceTimersByTimeAsync(500);

		expect(maxActive).toBe(1);
	});
});

describe('when a write fails', () => {
	it('keeps the content rather than losing it', async () => {
		const write = vi.fn(async () => {
			throw new Error('disk full');
		});
		const onError = vi.fn();
		const save = createAutosave({ write, delay: 500, onError });

		save.schedule(() => 'work');
		await vi.advanceTimersByTimeAsync(500);

		expect(onError).toHaveBeenCalled();
		expect(save.hasUnsavedChanges).toBe(true);
		expect(save.state).toBe('error');
	});

	it('retries on its own, without waiting for another edit', async () => {
		// The indicator says "retrying", so it has to actually retry. A researcher
		// who hits a transient failure and then stops typing must not be left with
		// unwritten work.
		let fail = true;
		const write = vi.fn(async () => {
			if (fail) throw new Error('disk full');
		});
		const save = createAutosave({ write, delay: 500, retryDelay: 2000, onError: () => {} });

		save.schedule(() => 'work');
		await vi.advanceTimersByTimeAsync(500);
		expect(save.state).toBe('error');

		fail = false;
		await vi.advanceTimersByTimeAsync(2000);

		expect(save.state).toBe('idle');
		expect(save.hasUnsavedChanges).toBe(false);
	});

	it('backs off rather than hammering an unwritable disk', async () => {
		const write = vi.fn(async () => {
			throw new Error('disk full');
		});
		const save = createAutosave({ write, delay: 500, retryDelay: 1000, onError: () => {} });

		save.schedule(() => 'work');
		await vi.advanceTimersByTimeAsync(500);
		expect(write).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1000);
		expect(write).toHaveBeenCalledTimes(2);

		// The next wait is longer, so this is not yet due.
		await vi.advanceTimersByTimeAsync(1000);
		expect(write).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(1000);
		expect(write).toHaveBeenCalledTimes(3);
	});

	it('writes it on the next attempt', async () => {
		let fail = true;
		const write = vi.fn(async () => {
			if (fail) throw new Error('disk full');
		});
		const save = createAutosave({ write, delay: 500, onError: () => {} });

		save.schedule(() => 'work');
		await vi.advanceTimersByTimeAsync(500);

		fail = false;
		await save.flush();

		expect(save.hasUnsavedChanges).toBe(false);
		expect(save.state).toBe('idle');
	});
});

describe('flushing', () => {
	it('writes immediately rather than waiting out the delay', async () => {
		// What closing a document has to do: the quiet period must not outlive it.
		const write = vi.fn(async () => {});
		const save = createAutosave({ write, delay: 5000 });

		save.schedule(() => 'unsaved');
		await save.flush();

		expect(write).toHaveBeenCalledWith('unsaved');
		expect(save.hasUnsavedChanges).toBe(false);
	});

	it('waits for a write already in flight and then writes what followed it', async () => {
		const disk = controllableWrite();
		const save = createAutosave({ write: disk.write, delay: 500 });

		save.schedule(() => 'first');
		await vi.advanceTimersByTimeAsync(500);
		save.schedule(() => 'second');

		const flushed = watch(save.flush());

		// Checked before each write completes. Awaiting only at the end would pass
		// even if flush resolved immediately — which it did, so closing a document
		// did not actually wait for the work to reach disk.
		await drainMicrotasks();
		expect(flushed.done).toBe(false);

		await disk.finish();
		await drainMicrotasks();
		expect(flushed.done).toBe(false);

		await disk.finish();
		await drainMicrotasks();
		expect(flushed.done).toBe(true);
		expect(disk.writes).toEqual(['first', 'second']);
	});

	it('reports unsaved changes while a write is still in flight', async () => {
		// The window-close path reads this before deciding to flush, so content
		// that is mid-write must count as unsaved.
		const disk = controllableWrite();
		const save = createAutosave({ write: disk.write, delay: 500 });

		save.schedule(() => 'work');
		await vi.advanceTimersByTimeAsync(500);

		expect(save.hasUnsavedChanges).toBe(true);

		await disk.finish();
		expect(save.hasUnsavedChanges).toBe(false);
	});

	it('does nothing when there is nothing to write', async () => {
		const write = vi.fn(async () => {});
		const save = createAutosave({ write, delay: 500 });

		await save.flush();

		expect(write).not.toHaveBeenCalled();
	});
});

describe('reporting state', () => {
	it('moves from pending to saving to idle', async () => {
		const seen: string[] = [];
		const write = vi.fn(async () => {});
		const save = createAutosave({ write, delay: 500, onStateChange: (s) => seen.push(s) });

		save.schedule(() => 'work');
		await vi.advanceTimersByTimeAsync(500);

		expect(seen).toEqual(['pending', 'saving', 'idle']);
	});

	it('stops the timer when destroyed', async () => {
		const write = vi.fn(async () => {});
		const save = createAutosave({ write, delay: 500 });

		save.schedule(() => 'work');
		save.destroy();
		await vi.advanceTimersByTimeAsync(5000);

		expect(write).not.toHaveBeenCalled();
	});
});
