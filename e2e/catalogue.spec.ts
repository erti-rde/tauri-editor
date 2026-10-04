import type { Locator, Page } from '@playwright/test';

import { PALETTES, type Density } from '../src/lib/theme/theme';
import { measure } from './contrast';
import { expect, test } from './harness';

/**
 * The catalogue in every palette at both densities (M1c-5, ADR 010).
 *
 * Each run measures the contrast of everything the primitives render, in every
 * state (AC-3), and with `ERTI_SHOTS` set, screenshots the page and each
 * overlay into `e2e/shots/catalogue/`, which CI keeps as an artefact (AC-2).
 */

const DENSITIES: Density[] = ['compact', 'comfortable'];

const shots = !!process.env.ERTI_SHOTS;

/**
 * Hover, focus and press can't be put in markup, and only one element can
 * really have each at a time. The devtools protocol can force the pseudo-class
 * on as many as we like, which is what Chromium's inspector does.
 */
const FORCE: Record<string, string[]> = {
	hover: ['hover'],
	focus: ['focus', 'focus-visible'],
	// Pressing a control means the pointer is over it too.
	active: ['hover', 'active']
};

async function forceStates(page: Page) {
	// Mark the control each specimen's state applies to: its `data-target`, or
	// the first control in it.
	const marked = await page.evaluate((states) => {
		let count = 0;
		for (const specimen of document.querySelectorAll<HTMLElement>('[data-specimen]')) {
			const state = specimen.dataset.state ?? '';
			if (!states.includes(state)) continue;
			const target = specimen.querySelector(
				specimen.dataset.target ??
					'button, input, textarea, [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [tabindex]'
			);
			if (!target) throw new Error(`Nothing to force ${state} on in ${specimen.dataset.specimen}`);
			target.setAttribute('data-force', state);
			count++;
		}
		return count;
	}, Object.keys(FORCE));

	const cdp = await page.context().newCDPSession(page);
	await cdp.send('DOM.enable');
	await cdp.send('CSS.enable');
	const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
	for (const [state, classes] of Object.entries(FORCE)) {
		const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
			nodeId: root.nodeId,
			selector: `[data-force="${state}"]`
		});
		for (const nodeId of nodeIds) {
			await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: classes });
		}
	}
	return marked;
}

/** Each overlay: how to open it, and where its content is drawn. */
const OVERLAYS: { name: string; open: (page: Page) => Promise<unknown>; content: string }[] = [
	{
		name: 'menu',
		// From the keyboard, so the first item is highlighted: a hover state too.
		open: async (page) => {
			await page.locator('[data-overlay="menu"] button').focus();
			await page.keyboard.press('Enter');
		},
		content: '[data-dropdown-menu-content]'
	},
	{
		name: 'select',
		open: (page) => page.locator('[data-overlay="select"] [data-select-trigger]').click(),
		content: '[data-select-content]'
	},
	{
		name: 'popover',
		open: (page) => page.locator('[data-overlay="popover"] button').click(),
		content: '[data-popover-content]'
	},
	{
		name: 'tooltip',
		open: (page) => page.locator('[data-overlay="tooltip"] button').hover(),
		content: '[data-tooltip-content]'
	},
	{
		name: 'dialog',
		open: (page) => page.locator('[data-overlay="dialog"] button').click(),
		content: '[data-dialog-content]'
	},
	{
		name: 'confirm',
		open: (page) => page.locator('[data-overlay="confirm"] button').click(),
		content: '[data-dialog-content]'
	}
];

async function settle(content: Locator) {
	await expect(content).toBeVisible();
	// bits-ui positions floating content a frame after it mounts.
	await expect(content).toHaveAttribute('data-state', /open|delayed-open|instant-open/);
}

for (const palette of PALETTES) {
	for (const density of DENSITIES) {
		test(`catalogue in ${palette.label}, ${density}`, async ({ page }) => {
			// Wide enough that the toasts, pinned to the corner, don't cover a specimen.
			await page.setViewportSize({ width: 1500, height: 900 });
			// Controls ease their colours, so a state forced a moment ago is still
			// on its way: a focus ring measured mid-transition is half the text
			// colour. Reduced motion zeroes the durations (M1c-1), so what's
			// measured and photographed is where each state lands.
			await page.emulateMedia({ reducedMotion: 'reduce' });
			await page.goto(`/harness/catalogue?theme=${palette.id}&density=${density}`);
			// The stored appearance is applied after mount; wait for it.
			await expect(page.locator('html')).toHaveAttribute('data-theme', palette.id);
			await expect(page.locator('html')).toHaveAttribute('data-density', density);
			await expect(page.getByRole('heading', { name: 'Catalogue' })).toBeVisible();

			// M1c-5 AC-1: every specimen rendered, and the forced states took.
			expect(await page.locator('[data-specimen]').count()).toBeGreaterThan(80);
			expect(await forceStates(page)).toBeGreaterThan(20);

			// M1c-5 AC-3
			const failures = await page.evaluate(measure, '[data-specimen]');
			expect(failures, 'pairs below WCAG AA on the catalogue').toEqual([]);

			// M1c-5 AC-2
			if (shots) {
				await page.screenshot({
					path: `e2e/shots/catalogue/${palette.id}-${density}.png`,
					fullPage: true
				});
			}

			for (const overlay of OVERLAYS) {
				await test.step(overlay.name, async () => {
					await overlay.open(page);
					const content = page.locator(overlay.content).last();
					await settle(content);

					const inside = await page.evaluate(measure, overlay.content);
					expect(inside, `pairs below WCAG AA in the ${overlay.name}`).toEqual([]);

					if (shots && density === 'compact') {
						await page.screenshot({
							path: `e2e/shots/catalogue/${palette.id}-${overlay.name}.png`
						});
					}

					await page.keyboard.press('Escape');
					await expect(content).toBeHidden();
					// A tooltip stays while the pointer is on its trigger.
					await page.mouse.move(0, 0);
				});
			}
		});
	}
}
