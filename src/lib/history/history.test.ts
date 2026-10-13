import { describe, expect, it } from 'vitest';

import type { Snapshot, Trigger } from '$lib/ipc/bindings';

import {
	byDay,
	clearable,
	dayLabel,
	previewLine,
	rowText,
	sizeLabel,
	TRIGGER_WORDS,
	wordDelta
} from './history';

/** Seconds for a time in the writer's own zone, as the view shows it. */
const local = (y: number, m: number, d: number, hh = 12, mm = 0) =>
	new Date(y, m - 1, d, hh, mm).getTime() / 1000;

const snap = (takenAt: number, words: number | null, trigger: Trigger | null = 'writing') =>
	({ file: `${takenAt}.erti.json`, takenAt, trigger, words, bytes: 100 }) satisfies Snapshot;

const now = new Date(2026, 9, 13, 15, 0);

describe('the History view’s words', () => {
	// M5-1 AC-4
	it('says the words gained or lost, in words', () => {
		expect(wordDelta(8412, 8100)).toBe('+312 words');
		expect(wordDelta(7208, 8412)).toBe('−1,204 words');
		expect(wordDelta(5, 4)).toBe('+1 word');
		expect(wordDelta(5, 5)).toBe('no change in words');
		expect(wordDelta(null, 5)).toBeNull();
		expect(wordDelta(5, null)).toBeNull();
	});

	// M5-1 AC-4
	it('groups by the writer’s day, newest first', () => {
		const snapshots = [
			snap(local(2026, 10, 13, 14, 20), 8412),
			snap(local(2026, 10, 13, 11, 5), 8100, 'before_restore'),
			snap(local(2026, 10, 12, 18, 40), 9304, 'close'),
			snap(local(2026, 10, 5, 9, 0), 7286, null),
			snap(local(2025, 12, 30, 9, 0), null)
		];
		const days = byDay(snapshots, now);

		expect(days.map((d) => d.label)).toEqual([
			'Today',
			'Yesterday',
			'Monday 5 October',
			'Tuesday 30 December 2025'
		]);
		expect(days.flatMap((d) => d.rows.map(rowText))).toEqual([
			'14:20 · while writing · +312 words',
			'11:05 · before restore · −1,204 words',
			'18:40 · on close · +2,018 words',
			'09:00',
			'09:00 · while writing'
		]);
	});

	it('names every trigger', () => {
		for (const trigger of ['writing', 'close', 'quit', 'before_restore'] as Trigger[]) {
			expect(TRIGGER_WORDS[trigger]).toMatch(/^[a-z ]+$/);
		}
	});

	it('says a day across midnight and a change of year', () => {
		const justAfterMidnight = new Date(2027, 0, 1, 0, 5);
		expect(dayLabel(local(2026, 12, 31, 23, 55), justAfterMidnight)).toBe('Yesterday');
		expect(dayLabel(local(2026, 12, 30), justAfterMidnight)).toBe('Wednesday 30 December 2026');
	});

	// M5-1 AC-4
	it('gives the size and what can be cleared after three months', () => {
		expect(sizeLabel(4_200_000)).toBe('4.2 MB');
		expect(sizeLabel(380_400)).toBe('380 KB');
		expect(sizeLabel(12)).toBe('12 bytes');
		expect(sizeLabel(1)).toBe('1 byte');

		const day = 86_400;
		const at = now.getTime() / 1000;
		expect(clearable([snap(at, 1), snap(at - 89 * day, 1), snap(at - 91 * day, 1)], now)).toBe(1);
	});

	// M5-1 AC-4
	it('heads the preview with when, how long and that it can’t be edited', () => {
		expect(previewLine(snap(local(2026, 10, 13, 11, 5), 8412), now)).toBe(
			'Today, 11:05 · 8,412 words · read-only'
		);
		expect(previewLine(snap(local(2026, 10, 12, 9, 0), null), now)).toBe(
			'Yesterday, 09:00 · read-only'
		);
	});
});
