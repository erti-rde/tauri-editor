import { writable } from 'svelte/store';

/**
 * How large the page is drawn, which is not how large the page is.
 *
 * Once the manuscript is a sheet rather than a column, it is taller than the
 * window and a full page cannot be seen at once — which is the whole reason to
 * paginate. Zooming out is how you check that a figure sits where you meant it
 * to, or that a chapter does not end one line onto a new page.
 *
 * Deliberately not part of `PageSetup`: it changes nothing about the document
 * or the export, only how big it looks right now. Storing it alongside paper
 * size would imply a manuscript zoomed to 50% prints at half size.
 *
 * `zoom` rather than `transform: scale()`, because zoom participates in layout:
 * the scrollable area shrinks with the content, where a transform leaves the
 * page occupying its full unscaled height and scrolling past the end of a
 * document that visibly stopped.
 */

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;

/** The stops the buttons walk through — round numbers a person would pick. */
export const ZOOM_STEPS = [0.5, 0.66, 0.75, 0.9, 1, 1.25, 1.5, 2] as const;

export const DEFAULT_ZOOM = 1;

export function clampZoom(value: number): number {
	if (!Number.isFinite(value)) return DEFAULT_ZOOM;
	return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/** The next stop up, or the current one if there is nothing above it. */
export function zoomIn(current: number): number {
	return ZOOM_STEPS.find((step) => step > current + 0.001) ?? clampZoom(current);
}

/** The next stop down. */
export function zoomOut(current: number): number {
	return [...ZOOM_STEPS].reverse().find((step) => step < current - 0.001) ?? clampZoom(current);
}

/** "66%", which is what the control shows and what a person says out loud. */
export function formatZoom(value: number): string {
	return `${Math.round(value * 100)}%`;
}

function createZoomStore() {
	const { subscribe, set } = writable(DEFAULT_ZOOM);

	return {
		subscribe,
		set: (value: number) => set(clampZoom(value)),
		in: (current: number) => set(zoomIn(current)),
		out: (current: number) => set(zoomOut(current)),
		reset: () => set(DEFAULT_ZOOM)
	};
}

export const zoomStore = createZoomStore();
