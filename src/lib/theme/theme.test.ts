import { describe, expect, it } from 'vitest';

import {
	DEFAULT_APPEARANCE,
	PAGE_SIZE_RANGE,
	UI_SIZE_RANGE,
	applyAppearance,
	normalise,
	resolveTheme
} from './theme';

describe('reading a stored appearance', () => {
	it('falls back to the defaults when nothing is stored', () => {
		expect(normalise(null)).toEqual(DEFAULT_APPEARANCE);
		expect(normalise({})).toEqual(DEFAULT_APPEARANCE);
	});

	it('keeps what was chosen', () => {
		const stored = { theme: 'dark' as const, density: 'comfortable' as const, uiSize: 15 };

		expect(normalise(stored)).toMatchObject({ theme: 'dark', density: 'comfortable', uiSize: 15 });
	});

	it('refuses a size that would make the app unusable', () => {
		// The settings file is on disk and can be hand-edited, and a 2px interface
		// cannot be recovered from inside the app.
		expect(normalise({ uiSize: 2 }).uiSize).toBe(UI_SIZE_RANGE.min);
		expect(normalise({ uiSize: 400 }).uiSize).toBe(UI_SIZE_RANGE.max);
		expect(normalise({ pageSize: 0 }).pageSize).toBe(PAGE_SIZE_RANGE.min);
	});

	it('survives a value of the wrong type', () => {
		expect(normalise({ theme: 'neon' } as never).theme).toBe('system');
		expect(normalise({ uiSize: 'big' } as never).uiSize).toBe(UI_SIZE_RANGE.min);
		expect(normalise({ pageFont: 'comic' } as never).pageFont).toBe('serif');
	});
});

describe('resolving the theme', () => {
	it('follows the system when asked to', () => {
		expect(resolveTheme('system', true)).toBe('dark');
		expect(resolveTheme('system', false)).toBe('light');
	});

	it('ignores the system when the user has chosen', () => {
		// Someone who picks light on a dark-mode machine means it.
		expect(resolveTheme('light', true)).toBe('light');
		expect(resolveTheme('dark', false)).toBe('dark');
	});
});

describe('applying it', () => {
	it('sets the attributes the stylesheet matches on', () => {
		const root = document.createElement('html');

		applyAppearance(root, normalise({ theme: 'dark', density: 'comfortable' }), false);

		expect(root.dataset.theme).toBe('dark');
		expect(root.dataset.density).toBe('comfortable');
	});

	it('sets the sizes as custom properties', () => {
		const root = document.createElement('html');

		applyAppearance(root, normalise({ uiSize: 15, pageSize: 18 }), false);

		expect(root.style.getPropertyValue('--ui-size')).toBe('15px');
		expect(root.style.getPropertyValue('--page-size')).toBe('18px');
	});

	it('follows the system preference when the choice is system', () => {
		const root = document.createElement('html');

		applyAppearance(root, normalise({ theme: 'system' }), true);

		expect(root.dataset.theme).toBe('dark');
	});

	it('names a real font family for the manuscript', () => {
		const root = document.createElement('html');

		applyAppearance(root, normalise({ pageFont: 'mono' }), false);

		expect(root.style.getPropertyValue('--page-font')).toContain('monospace');
	});
});
