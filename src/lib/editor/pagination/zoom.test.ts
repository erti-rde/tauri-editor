import { describe, expect, it } from 'vitest';

import {
	DEFAULT_ZOOM,
	ZOOM_MAX,
	ZOOM_MIN,
	ZOOM_STEPS,
	clampZoom,
	formatZoom,
	zoomIn,
	zoomOut
} from './zoom';

describe('walking the zoom steps', () => {
	it('goes up to the next stop', () => {
		expect(zoomIn(1)).toBe(1.25);
		expect(zoomIn(0.5)).toBe(0.66);
	});

	it('goes down to the previous stop', () => {
		expect(zoomOut(1)).toBe(0.9);
		expect(zoomOut(2)).toBe(1.5);
	});

	it('stops at the ends rather than running past them', () => {
		expect(zoomIn(ZOOM_MAX)).toBe(ZOOM_MAX);
		expect(zoomOut(ZOOM_MIN)).toBe(ZOOM_MIN);
	});

	it('lands on a stop from a value between two of them', () => {
		// Ctrl-scroll or a hand-set value can leave zoom off the ladder; pressing
		// the button then has to move, not sit still on a rounding comparison.
		expect(zoomIn(0.8)).toBe(0.9);
		expect(zoomOut(0.8)).toBe(0.75);
	});

	it('moves off a stop it is exactly on', () => {
		// The float comparison this guards: 0.66 in, then out, must come back.
		expect(zoomOut(zoomIn(0.66))).toBe(0.66);
	});

	it('walks the whole ladder in both directions', () => {
		let value: number = ZOOM_MIN;
		const up = [value];
		for (let i = 0; i < ZOOM_STEPS.length + 2; i++) {
			const next = zoomIn(value);
			if (next === value) break;
			value = next;
			up.push(value);
		}

		expect(up).toEqual([...ZOOM_STEPS]);
		expect(value).toBe(ZOOM_MAX);
	});
});

describe('keeping zoom in range', () => {
	it('refuses a value outside the ends', () => {
		expect(clampZoom(10)).toBe(ZOOM_MAX);
		expect(clampZoom(0.01)).toBe(ZOOM_MIN);
	});

	it('falls back to normal size for anything that is not a usable number', () => {
		// A zoom of NaN makes the manuscript vanish. Infinity goes to the default
		// too rather than to the maximum: neither is a size someone asked for, and
		// returning to 100% is the recoverable answer.
		expect(clampZoom(NaN)).toBe(DEFAULT_ZOOM);
		expect(clampZoom(Infinity)).toBe(DEFAULT_ZOOM);
		expect(clampZoom(-Infinity)).toBe(DEFAULT_ZOOM);
	});
});

describe('showing the zoom', () => {
	it('reads as a percentage', () => {
		expect(formatZoom(1)).toBe('100%');
		expect(formatZoom(0.66)).toBe('66%');
		expect(formatZoom(0.5)).toBe('50%');
	});
});
