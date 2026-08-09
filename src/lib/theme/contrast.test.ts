// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PALETTES } from './theme';

/**
 * Every palette has to be readable.
 *
 * The first light palette shipped at 3.37:1 for white text on the primary
 * button — below the 4.5:1 WCAG AA threshold, which made the most important
 * control the least legible thing on screen. It was found by someone looking at
 * it, which is the expensive way.
 *
 * These read the token values out of the stylesheets and compute the ratios, so
 * a palette added later cannot ship unreadable and a value nudged for looks
 * cannot quietly drop below the line.
 */

const css =
	readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8') +
	readFileSync(fileURLToPath(new URL('./palettes.css', import.meta.url)), 'utf8');

/** The token block for one palette. `light` also lives on `:root`. */
function blockFor(id: string): string {
	const pattern =
		id === 'light'
			? /:root,\s*\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/
			: new RegExp(`\\[data-theme='${id}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`);

	const found = css.match(pattern);
	if (!found) throw new Error(`No token block found for palette "${id}"`);
	return found[1];
}

function token(block: string, name: string): [number, number, number] {
	const found = block.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
	if (!found) throw new Error(`Token --${name} is missing`);
	return [Number(found[1]), Number(found[2]), Number(found[3])];
}

function toRgb([h, s, l]: [number, number, number]): [number, number, number] {
	const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
	};
	return [f(0), f(8), f(4)];
}

function luminance(hsl: [number, number, number]): number {
	const [r, g, b] = toRgb(hsl).map((v) =>
		v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
	);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA for body text, and for the text on a control. */
const AA = 4.5;
/** WCAG AA for large text and for a border carrying meaning. */
const AA_LARGE = 3;

describe.each(PALETTES.map((p) => [p.id, p.label] as const))('%s', (id) => {
	const block = blockFor(id);
	const at = (name: string) => token(block, name);

	it('reads body text against its surface', () => {
		expect(contrast(at('ink'), at('surface'))).toBeGreaterThanOrEqual(AA);
	});

	it('reads body text against a raised surface', () => {
		// Cards, popovers and the settings panel all sit on this.
		expect(contrast(at('ink'), at('surface-raised'))).toBeGreaterThanOrEqual(AA);
	});

	it('reads muted text against its surface', () => {
		// Hints and secondary labels are still text someone has to read.
		expect(contrast(at('ink-muted'), at('surface'))).toBeGreaterThanOrEqual(AA);
	});

	it('shows faint marks against their surface', () => {
		// The gap this closes: `ink` and `ink-muted` were asserted and `ink-faint`
		// was not, while it was setting the save state, project paths, timestamps
		// and "No author" at between 2.31 and 3.89 to 1.
		//
		// Held to the non-text threshold rather than AA, because it cannot reach
		// 4.5 and stay a third tier — `ink-muted` is already 4.77 on the light
		// palette. So it stopped being a text colour instead, and everything that
		// was text moved to `ink-muted`.
		expect(contrast(at('ink-faint'), at('surface'))).toBeGreaterThanOrEqual(AA_LARGE);
	});

	it('reads the label on a primary button', () => {
		// The one that shipped broken: 3.37:1 on the light palette.
		expect(contrast(at('accent-ink'), at('accent'))).toBeGreaterThanOrEqual(AA);
	});

	it('shows the accent against the surface it sits on', () => {
		// A focus ring and a selected border have to be visible without being text.
		expect(contrast(at('accent'), at('surface'))).toBeGreaterThanOrEqual(AA_LARGE);
	});

	/*
	 * Every surface a component actually puts text on.
	 *
	 * `ink-faint` was caught by opening the app, not by this suite, and the
	 * reason is that the suite asserted the pairs someone thought of rather than
	 * the pairs the markup uses. These are counted out of the components:
	 * `bg-surface-sunken` and `bg-surface-hover` appear 18 times each,
	 * `bg-surface-raised` 23, `bg-accent-quiet` 10 and `bg-surface-overlay` 4 —
	 * and text sits on all of them.
	 */
	const TEXT_SURFACES = [
		'surface',
		'surface-raised',
		'surface-sunken',
		'surface-overlay',
		'surface-hover',
		'accent-quiet'
	];

	it.each(TEXT_SURFACES)('reads body text on %s', (surface) => {
		expect(contrast(at('ink'), at(surface))).toBeGreaterThanOrEqual(AA);
	});

	it.each(TEXT_SURFACES)('reads muted text on %s', (surface) => {
		expect(contrast(at('ink-muted'), at(surface))).toBeGreaterThanOrEqual(AA);
	});

	/*
	 * The three colours that report state, on the two surfaces they report it on.
	 *
	 * All three are prose, which is why they are held to AA and not to 3:1:
	 * danger is "Not saved — retrying" in the status bar and the error banner on
	 * the main route; warning is the failed-ingest message and "N sources need
	 * attention"; success is the similarity score on a result card. A status
	 * message nobody can read is the one message that has to be readable.
	 *
	 * `surface-sunken` is in here because that is what every one of those banners
	 * and badges actually sits on — asserting against `--surface` alone is what
	 * let `warning` ship at 2.35:1.
	 */
	it.each(
		['danger', 'warning', 'success'].flatMap((ink) =>
			['surface', 'surface-sunken'].map((surface) => [ink, surface] as const)
		)
	)('reads %s on %s', (ink, surface) => {
		expect(contrast(at(ink), at(surface))).toBeGreaterThanOrEqual(AA);
	});

	it('shows an active toolbar control', () => {
		// `text-accent` on `bg-accent-quiet` is how a pressed toolbar button is
		// drawn — and every such control renders an <Icon />, so this is the
		// non-text threshold. The one place it coloured an actual number, the
		// similarity badge on a result card, now takes `ink` instead.
		expect(contrast(at('accent'), at('accent-quiet'))).toBeGreaterThanOrEqual(AA_LARGE);
	});

	it('keeps a filled accent button legible on hover', () => {
		// The hover state is a button someone is looking straight at; it has to
		// clear AA against the same ink as the resting state.
		expect(contrast(at('accent-ink'), at('accent-hover'))).toBeGreaterThanOrEqual(AA);
		// And it has to actually differ from resting, or it is not a hover state.
		expect(contrast(at('accent-hover'), at('accent'))).toBeGreaterThan(1.15);
	});

	it('separates a rule from the surface it divides', () => {
		// A border nobody can see is a border that does not do its job.
		expect(contrast(at('line'), at('surface'))).toBeGreaterThan(1.1);
	});
});
