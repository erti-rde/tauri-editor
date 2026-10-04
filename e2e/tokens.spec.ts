import type { Page } from '@playwright/test';
import { expect, launch, openProject, test } from './harness';

/**
 * The tokens as the browser computes them (M1c-1, ADR 010). jsdom resolves
 * neither `calc()` nor `var()`, so these run in Chromium on the harness.
 */

const STEPS = ['caption', 'small', 'body', 'title', 'heading', 'display'] as const;

/** Each step's computed font size, in px, measured on a probe in the page. */
function typeScale(page: Page) {
	return page.evaluate((steps) => {
		return Object.fromEntries(
			steps.map((step) => {
				const probe = document.createElement('span');
				probe.style.fontSize = `var(--text-${step})`;
				document.body.append(probe);
				const size = parseFloat(getComputedStyle(probe).fontSize);
				probe.remove();
				return [step, size];
			})
		);
	}, STEPS);
}

/** A duration token as a transition computes it, in ms. */
const duration = (page: Page, name: string) =>
	page.evaluate((n) => {
		const probe = document.createElement('div');
		probe.style.transitionDuration = `var(${n})`;
		document.body.append(probe);
		const seconds = parseFloat(getComputedStyle(probe).transitionDuration);
		probe.remove();
		return Math.round(seconds * 1000);
	}, name);

// M1c-1 AC-2
test('the type scale follows the interface size set in Appearance', async ({ page }) => {
	await launch(page);
	await openProject(page);

	// The default interface size is 13px.
	expect(await typeScale(page)).toEqual({
		caption: 11,
		small: 12,
		body: 13,
		title: 15,
		heading: 18,
		display: 24
	});

	await page.getByRole('button', { name: 'Settings' }).click();
	const settings = page.getByRole('dialog', { name: 'Settings' });
	await settings.getByRole('tab', { name: 'Appearance' }).click();
	await settings.getByRole('slider').first().fill('16');

	expect(await typeScale(page)).toEqual({
		caption: 14,
		small: 15,
		body: 16,
		title: 18,
		heading: 21,
		display: 27
	});
});

// M1c-1 AC-3
test('motion is zero when less motion is asked for', async ({ page }) => {
	await launch(page);
	expect(await duration(page, '--duration-fast')).toBe(120);
	expect(await duration(page, '--duration')).toBe(180);

	await page.emulateMedia({ reducedMotion: 'reduce' });
	expect(await duration(page, '--duration-fast')).toBe(0);
	expect(await duration(page, '--duration')).toBe(0);
});

// M1c-1 AC-1, AC-4: the overlay shadow is real, and tinted by the palette.
// `shadow-popover` wrapped an `hsla()` in another and drew nothing.
test('an overlay casts the palette’s shadow', async ({ page }) => {
	await launch(page);
	const shadow = () =>
		page.evaluate(() => {
			const probe = document.createElement('div');
			probe.className = 'shadow-overlay';
			document.body.append(probe);
			const value = getComputedStyle(probe).boxShadow;
			probe.remove();
			return value;
		});

	expect(await shadow()).toContain('rgba(0, 0, 0, 0.12)');
	await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
	expect(await shadow()).toContain('rgba(0, 0, 0, 0.5)');
});
