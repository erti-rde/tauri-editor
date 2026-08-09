/**
 * Appearance, and where it is remembered.
 *
 * Kept out of the component tree because the choice has to be applied to
 * `<html>` before the first paint — a theme that arrives a frame late shows
 * every user a flash of the wrong one on every launch.
 */

/**
 * The palettes on offer.
 *
 * Erti's own two, plus the editor themes researchers already have their eyes
 * trained on. A palette is a block of token assignments in CSS and nothing
 * more — this list only has to agree with the selectors in palettes.css.
 */
export const PALETTES = [
	{ id: 'light', label: 'Erti Light', mode: 'light' },
	{ id: 'dark', label: 'Erti Dark', mode: 'dark' },
	{ id: 'catppuccin-latte', label: 'Catppuccin Latte', mode: 'light' },
	{ id: 'catppuccin-frappe', label: 'Catppuccin Frappé', mode: 'dark' },
	{ id: 'catppuccin-macchiato', label: 'Catppuccin Macchiato', mode: 'dark' },
	{ id: 'catppuccin-mocha', label: 'Catppuccin Mocha', mode: 'dark' },
	{ id: 'night-owl', label: 'Night Owl', mode: 'dark' }
] as const;

export type PaletteId = (typeof PALETTES)[number]['id'];
export type ThemeChoice = PaletteId | 'system';
export type Density = 'compact' | 'comfortable';

const PALETTE_IDS = PALETTES.map((p) => p.id) as readonly string[];

export const paletteMode = (id: PaletteId): 'light' | 'dark' =>
	PALETTES.find((p) => p.id === id)?.mode ?? 'light';

export interface Appearance {
	theme: ThemeChoice;
	density: Density;
	/** Interface text size in pixels. The app is small and dense by default. */
	uiSize: number;
	/** Manuscript text size in pixels. */
	pageSize: number;
	/** Typeface for the manuscript. */
	pageFont: 'serif' | 'sans' | 'mono';
	/**
	 * Keep the manuscript on a paper surface in dark palettes.
	 *
	 * On by default because long prose is harder to read inverted, and because
	 * what is on screen should look like what comes out of the printer. It is a
	 * choice rather than a rule, since someone who picked an editor palette may
	 * well want the whole window in it.
	 */
	paperPage: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
	theme: 'system',
	density: 'compact',
	uiSize: 13,
	pageSize: 16,
	pageFont: 'serif',
	paperPage: true
};

/** Sizes outside this are unreadable or unusable rather than merely unusual. */
export const UI_SIZE_RANGE = { min: 11, max: 18 } as const;
export const PAGE_SIZE_RANGE = { min: 13, max: 24 } as const;

const PAGE_FONTS: Record<Appearance['pageFont'], string> = {
	serif: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
	sans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
	mono: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace"
};

function clamp(value: number, { min, max }: { min: number; max: number }): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, Math.round(value)));
}

/** Fill in anything missing or nonsensical, so a hand-edited settings file opens. */
export function normalise(input: Partial<Appearance> | null | undefined): Appearance {
	const raw = input ?? {};

	return {
		theme:
			raw.theme === 'system' || PALETTE_IDS.includes(raw.theme as string)
				? (raw.theme as ThemeChoice)
				: DEFAULT_APPEARANCE.theme,
		density: raw.density === 'comfortable' ? 'comfortable' : 'compact',
		uiSize: clamp(Number(raw.uiSize ?? DEFAULT_APPEARANCE.uiSize), UI_SIZE_RANGE),
		pageSize: clamp(Number(raw.pageSize ?? DEFAULT_APPEARANCE.pageSize), PAGE_SIZE_RANGE),
		pageFont:
			raw.pageFont && Object.hasOwn(PAGE_FONTS, raw.pageFont)
				? raw.pageFont
				: DEFAULT_APPEARANCE.pageFont,
		paperPage: raw.paperPage !== false
	};
}

/** Which theme `system` currently means. */
export function systemTheme(matches: boolean): 'light' | 'dark' {
	return matches ? 'dark' : 'light';
}

/** The palette actually in force, resolving `system` against the OS. */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): PaletteId {
	return choice === 'system' ? systemTheme(prefersDark) : choice;
}

/**
 * Write the appearance onto an element, usually `<html>`.
 *
 * Attributes rather than classes, so the CSS reads as `[data-theme='dark']` —
 * which says what it matches, and cannot collide with a utility class.
 */
export function applyAppearance(
	root: HTMLElement,
	appearance: Appearance,
	prefersDark: boolean
): void {
	const palette = resolveTheme(appearance.theme, prefersDark);

	root.dataset.theme = palette;
	root.dataset.density = appearance.density;
	// The page follows the palette only when the reader asks it to; the default
	// keeps prose on paper.
	root.dataset.page = appearance.paperPage ? 'paper' : 'themed';

	root.style.setProperty('--ui-size', `${appearance.uiSize}px`);
	root.style.setProperty('--page-size', `${appearance.pageSize}px`);
	root.style.setProperty('--page-font', PAGE_FONTS[appearance.pageFont]);
}
