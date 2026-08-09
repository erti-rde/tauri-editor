/**
 * Appearance, and where it is remembered.
 *
 * Kept out of the component tree because the choice has to be applied to
 * `<html>` before the first paint — a theme that arrives a frame late shows
 * every user a flash of the wrong one on every launch.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';
export type Density = 'compact' | 'comfortable';

export interface Appearance {
	theme: ThemeChoice;
	density: Density;
	/** Interface text size in pixels. The app is small and dense by default. */
	uiSize: number;
	/** Manuscript text size in pixels. */
	pageSize: number;
	/** Typeface for the manuscript. */
	pageFont: 'serif' | 'sans' | 'mono';
}

export const DEFAULT_APPEARANCE: Appearance = {
	theme: 'system',
	density: 'compact',
	uiSize: 13,
	pageSize: 16,
	pageFont: 'serif'
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
		theme: (['light', 'dark', 'system'] as const).includes(raw.theme as ThemeChoice)
			? (raw.theme as ThemeChoice)
			: DEFAULT_APPEARANCE.theme,
		density: raw.density === 'comfortable' ? 'comfortable' : 'compact',
		uiSize: clamp(Number(raw.uiSize ?? DEFAULT_APPEARANCE.uiSize), UI_SIZE_RANGE),
		pageSize: clamp(Number(raw.pageSize ?? DEFAULT_APPEARANCE.pageSize), PAGE_SIZE_RANGE),
		pageFont:
			raw.pageFont && raw.pageFont in PAGE_FONTS ? raw.pageFont : DEFAULT_APPEARANCE.pageFont
	};
}

/** Which theme `system` currently means. */
export function systemTheme(matches: boolean): 'light' | 'dark' {
	return matches ? 'dark' : 'light';
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'light' | 'dark' {
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
	root.dataset.theme = resolveTheme(appearance.theme, prefersDark);
	root.dataset.density = appearance.density;

	root.style.setProperty('--ui-size', `${appearance.uiSize}px`);
	root.style.setProperty('--page-size', `${appearance.pageSize}px`);
	root.style.setProperty('--page-font', PAGE_FONTS[appearance.pageFont]);
}
