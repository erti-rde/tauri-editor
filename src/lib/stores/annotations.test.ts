import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

import { annotationsStore, colourFor } from './annotations.svelte';
import { annotationLabels, annotationsForSource, sourceForPath, type AnnotationLabel } from './db';

/**
 * The store behind the reading marks.
 *
 * The case worth pinning down is the ordinary one: opening a paper the library
 * already knows. That is the path every real paper takes, and it is the one that
 * was broken — labels were fetched only on the branch for a paper the library
 * had never seen, so the highlight menu came up with no colours in it and
 * highlighting silently fell back to a hardcoded yellow.
 */

vi.mock('./db', () => ({
	annotationLabels: vi.fn(),
	annotationsForSource: vi.fn(),
	sourceForPath: vi.fn(),
	saveAnnotation: vi.fn(),
	deleteAnnotation: vi.fn(),
	embedAnnotation: vi.fn()
}));

vi.mock('@tauri-apps/plugin-store', () => ({
	load: vi.fn(async () => ({ get: vi.fn(async () => undefined), set: vi.fn(), save: vi.fn() }))
}));

const labels: AnnotationLabel[] = [
	{ id: 'claim', name: 'Claim', colour: '45 95% 62%', position: 0, enabled: true },
	{ id: 'method', name: 'Method', colour: '210 80% 65%', position: 1, enabled: true }
];

beforeEach(() => {
	vi.clearAllMocks();
	annotationsStore.reset();
	vi.mocked(annotationLabels).mockResolvedValue(labels);
	vi.mocked(annotationsForSource).mockResolvedValue([]);
	vi.mocked(sourceForPath).mockResolvedValue('sha-1');
});

describe('opening a paper', () => {
	it('has the labels for a paper the library knows', async () => {
		// Without these the highlight menu has no colours to offer.
		await annotationsStore.openPath('/papers/one.pdf');

		expect(get(annotationsStore).labels).toEqual(labels);
	});

	it('has the labels for a paper the library has never seen', async () => {
		// A PDF dropped in a folder and opened before the scan reached it still
		// gets a menu, even though there is nowhere yet to save a mark.
		vi.mocked(sourceForPath).mockResolvedValue(null);

		await annotationsStore.openPath('/papers/new.pdf');

		expect(get(annotationsStore).labels).toEqual(labels);
		expect(get(annotationsStore).sha256).toBeNull();
	});

	it('picks a label to highlight with, so marking is one action', async () => {
		await annotationsStore.openPath('/papers/one.pdf');

		expect(get(annotationsStore).lastLabel).toBe('claim');
	});

	it('loads the marks already on the paper', async () => {
		vi.mocked(annotationsForSource).mockResolvedValue([
			{ id: 'a1', sha256: 'sha-1', page: 4 } as never
		]);

		await annotationsStore.openPath('/papers/one.pdf');

		expect(get(annotationsStore).annotations).toHaveLength(1);
	});

	it('still has its labels when the marks cannot be read', async () => {
		vi.mocked(annotationsForSource).mockRejectedValue(new Error('library is not open'));

		await annotationsStore.openPath('/papers/one.pdf');

		expect(get(annotationsStore).labels).toEqual(labels);
	});

	it('survives a library that will not answer at all', async () => {
		vi.mocked(annotationLabels).mockRejectedValue(new Error('library is not open'));
		vi.mocked(sourceForPath).mockRejectedValue(new Error('library is not open'));

		await annotationsStore.openPath('/papers/one.pdf');

		expect(get(annotationsStore).labels).toEqual([]);
	});

	it('does not choke on a backend that answers with nothing', async () => {
		vi.mocked(annotationLabels).mockResolvedValue(undefined as never);

		await annotationsStore.openPath('/papers/one.pdf');

		expect(get(annotationsStore).labels).toEqual([]);
	});
});

describe('the colour a mark is drawn in', () => {
	it('uses the label’s colour', () => {
		expect(colourFor(labels, 'method')).toBe('210 80% 65%');
	});

	it('falls back for a mark with no label', () => {
		expect(colourFor(labels, null)).toBe('45 90% 60%');
	});

	it('falls back for a label that has since been deleted', () => {
		// Removing a colour keeps the marks filed under it; they have to draw as
		// something.
		expect(colourFor(labels, 'gone')).toBe('45 90% 60%');
	});
});
