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

	const write = vi.fn(async (content: unknown) => {
		writes.push(content);
		await new Promise<void>((resolve) => {
			release = resolve;
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
		}
	};
}

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

		const flushed = save.flush();
		await disk.finish();
		await disk.finish();
		await flushed;

		expect(disk.writes).toEqual(['first', 'second']);
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
