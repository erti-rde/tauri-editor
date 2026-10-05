import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

import { cursorMemory, waitingCite } from './citeLater';

beforeEach(() => {
	waitingCite.take();
	cursorMemory.reset();
});

describe('a citation asked for away from the manuscript (M1b-8)', () => {
	// M1b-8 AC-3
	it('waits until it is taken, and is taken once', () => {
		expect(waitingCite.take()).toBeNull();

		waitingCite.request({ id: 'erti:ong', locator: '78' });
		expect(get(waitingCite)).toEqual({ id: 'erti:ong', locator: '78' });

		expect(waitingCite.take()).toEqual({ id: 'erti:ong', locator: '78' });
		expect(waitingCite.take()).toBeNull();
	});

	it('is the latest asked for', () => {
		waitingCite.request({ id: 'a', locator: '1' });
		waitingCite.request({ id: 'b', locator: null });
		expect(waitingCite.take()).toEqual({ id: 'b', locator: null });
	});
});

describe('where the writer left off', () => {
	it('is remembered for each manuscript', () => {
		cursorMemory.remember('/p/Chapter 1.erti.json', 120);
		cursorMemory.remember('/p/Chapter 2.erti.json', 8);
		cursorMemory.remember('/p/Chapter 1.erti.json', 140);

		expect(cursorMemory.recall('/p/Chapter 1.erti.json')).toBe(140);
		expect(cursorMemory.recall('/p/Chapter 2.erti.json')).toBe(8);
		expect(cursorMemory.recall('/p/Chapter 3.erti.json')).toBeUndefined();
		expect(cursorMemory.recall(undefined)).toBeUndefined();
	});
});
