import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

import { annotationsStore, colourFor } from './annotations.svelte';
import {
	annotationLabels,
	annotationsForSource,
	saveAnnotation,
	sourceForPath,
	type AnnotationLabel
} from './db';

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

describe('a paper removed from the library', () => {
	// Removing a source (M1b-4) deletes its marks' rows. What the store still
	// holds would draw marks that are gone, and an undo would write into a
	// source the library no longer has.
	const one = '/papers/one.pdf';

	it('drops the open paper’s marks, and what Ctrl+Z would undo', async () => {
		vi.mocked(annotationsForSource).mockResolvedValue([
			{ id: 'a1', sha256: 'sha-1', page: 4 } as never
		]);
		await annotationsStore.openPath(one);
		await annotationsStore.remove('a1', 'that deletion');

		annotationsStore.dropIf((path) => path === one);

		const state = get(annotationsStore);
		expect(state.sha256).toBeNull();
		expect(state.annotations).toEqual([]);
		expect(state.undoable).toBeNull();
		expect(await annotationsStore.undo()).toBeNull();
		expect(saveAnnotation).not.toHaveBeenCalled();
		// The labels belong to the library, not to the paper.
		expect(state.labels).toEqual(labels);
	});

	it('keeps the marks of a paper that is still there', async () => {
		vi.mocked(annotationsForSource).mockResolvedValue([
			{ id: 'a1', sha256: 'sha-1', page: 4 } as never
		]);
		await annotationsStore.openPath(one);

		annotationsStore.dropIf((path) => path === '/papers/two.pdf');

		expect(get(annotationsStore).sha256).toBe('sha-1');
		expect(get(annotationsStore).annotations).toHaveLength(1);
	});

	it('does not let a load still under way bring them back', async () => {
		let found: (sha: string | null) => void = () => {};
		vi.mocked(sourceForPath).mockReturnValue(new Promise((resolve) => (found = resolve)));
		vi.mocked(annotationsForSource).mockResolvedValue([
			{ id: 'a1', sha256: 'sha-1', page: 4 } as never
		]);
		const opening = annotationsStore.openPath(one);
		await vi.waitFor(() => expect(sourceForPath).toHaveBeenCalled());

		annotationsStore.dropIf((path) => path === one);
		found('sha-1');
		await opening;

		expect(get(annotationsStore).sha256).toBeNull();
		expect(get(annotationsStore).annotations).toEqual([]);
		expect(get(annotationsStore).loading).toBe(false);
	});

	it('leaves no paper behind a load that a later, failed one overtook', async () => {
		// Writes go to the paper the store shows, or to none: a load overtaken
		// once it knew its paper used to leave saves reloading that one.
		let marks: (loaded: never[]) => void = () => {};
		vi.mocked(sourceForPath).mockResolvedValueOnce('sha-a');
		vi.mocked(annotationsForSource).mockReturnValueOnce(
			new Promise((resolve) => (marks = resolve))
		);
		const first = annotationsStore.openPath('/papers/a.pdf');
		await vi.waitFor(() => expect(annotationsForSource).toHaveBeenCalledWith('sha-a'));

		vi.mocked(sourceForPath).mockRejectedValueOnce(new Error('the library is busy'));
		await annotationsStore.openPath('/papers/b.pdf');
		marks([]);
		await first;
		vi.mocked(annotationsForSource).mockClear();

		await annotationsStore.save({ id: 'm1', sha256: 'sha-b', page: 1 } as never);

		expect(get(annotationsStore).sha256).toBeNull();
		expect(annotationsForSource).not.toHaveBeenCalledWith('sha-a');
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
