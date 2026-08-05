import { describe, expect, it, vi } from 'vitest';

import { commitIngest, selectSourcesToIngest, type CommitDeps } from './pipeline';
import type { Chunk } from './chunk';

/**
 * Every case here is a defect that reached review, in the layer that had no
 * tests because it imports Tauri at module scope.
 */

function chunk(text: string, page = 1): Chunk {
	return {
		text,
		pageStart: page,
		pageEnd: page,
		section: 'Results',
		charStart: 0,
		charEnd: text.length
	};
}

/** Records the order of durable writes, so ordering can be asserted directly. */
function recordingDeps(overrides: Partial<CommitDeps> = {}) {
	const calls: string[] = [];
	const deps: CommitDeps = {
		setSourceMetadata: vi.fn(async () => {
			calls.push('setSourceMetadata');
		}),
		storeChunks: vi.fn(async () => {
			calls.push('storeChunks');
		}),
		markLegacyConsumed: vi.fn(async () => {
			calls.push('markLegacyConsumed');
		}),
		...overrides
	};
	return { calls, deps };
}

describe('choosing what to ingest', () => {
	const deps = (unfinished: string[], hashes: Record<string, string>, isNew = false) => ({
		hashFile: async (path: string) => hashes[path],
		registerSource: async () => isNew,
		unfinished: new Set(unfinished)
	});

	it('retries a source whose previous ingest failed', async () => {
		// registerSource reports whether the *row* was new, which for a source
		// that already failed is false. Selecting on that value is the old
		// filename dedup with a hash in its place: 41% of a real corpus was
		// registered, never processed, and never offered again.
		const files = [{ path: '/a/failed.pdf', name: 'failed.pdf' }];

		const selected = await selectSourcesToIngest(
			files,
			deps(['sha-failed'], { '/a/failed.pdf': 'sha-failed' })
		);

		expect(selected.map((f) => f.sha256)).toEqual(['sha-failed']);
	});

	it('leaves a finished source alone', async () => {
		const files = [{ path: '/a/done.pdf', name: 'done.pdf' }];

		const selected = await selectSourcesToIngest(files, deps([], { '/a/done.pdf': 'sha-done' }));

		expect(selected).toEqual([]);
	});

	it('takes a source the library has never seen', async () => {
		const files = [{ path: '/a/new.pdf', name: 'new.pdf' }];

		const selected = await selectSourcesToIngest(
			files,
			deps([], { '/a/new.pdf': 'sha-new' }, /* isNew */ true)
		);

		expect(selected.map((f) => f.sha256)).toEqual(['sha-new']);
	});

	it('ingests one paper once even when it is in the folder twice', async () => {
		// Same bytes, two names. Content addressing makes it one source, so
		// embedding it twice would be wasted work and a duplicate chunk set.
		const files = [
			{ path: '/a/paper.pdf', name: 'paper.pdf' },
			{ path: '/a/paper-copy.pdf', name: 'paper-copy.pdf' }
		];

		const selected = await selectSourcesToIngest(
			files,
			deps(['sha-same'], { '/a/paper.pdf': 'sha-same', '/a/paper-copy.pdf': 'sha-same' })
		);

		expect(selected).toHaveLength(1);
	});

	it('carries on past a file it cannot read', async () => {
		const onError = vi.fn();
		const files = [
			{ path: '/a/broken.pdf', name: 'broken.pdf' },
			{ path: '/a/fine.pdf', name: 'fine.pdf' }
		];

		const selected = await selectSourcesToIngest(files, {
			hashFile: async (path) => {
				if (path === '/a/broken.pdf') throw new Error('permission denied');
				return 'sha-fine';
			},
			registerSource: async () => true,
			unfinished: new Set(),
			onError
		});

		expect(selected.map((f) => f.name)).toEqual(['fine.pdf']);
		expect(onError).toHaveBeenCalledWith(files[0], 'permission denied');
	});
});

describe('committing an ingested source', () => {
	const resolved = { metadata: { title: 'A paper' }, via: 'pdf-doi' as const, doi: '10.1/x' };

	it('writes metadata before the chunks that mark the source ready', async () => {
		// storeChunks flips the source to ready. In the other order, a failure in
		// between left a ready source with no csl_json — which no scan offers
		// again, so the paper could never be cited and never be retried.
		const { calls, deps } = recordingDeps();

		await commitIngest('sha', 'p.pdf', [chunk('body')], [[0.1]], resolved, deps);

		expect(calls).toEqual(['setSourceMetadata', 'storeChunks']);
	});

	it('leaves the source unready when the metadata write fails', async () => {
		const { calls, deps } = recordingDeps({
			setSourceMetadata: vi.fn(async () => {
				throw new Error('database is locked');
			})
		});

		await expect(
			commitIngest('sha', 'p.pdf', [chunk('body')], [[0.1]], resolved, deps)
		).rejects.toThrow('database is locked');

		expect(calls).not.toContain('storeChunks');
	});

	it('consumes the salvaged row only after the metadata is stored', async () => {
		// Consuming it during resolution discarded it on any later failure, and
		// the retry then found nothing to carry forward — destroying exactly the
		// metadata the salvage migration exists to preserve.
		const { calls, deps } = recordingDeps();

		await commitIngest(
			'sha',
			'p.pdf',
			[chunk('body')],
			[[0.1]],
			{ ...resolved, via: 'legacy' },
			deps
		);

		expect(calls).toEqual(['setSourceMetadata', 'markLegacyConsumed', 'storeChunks']);
	});

	it('keeps the salvaged row when the metadata write fails', async () => {
		const { deps } = recordingDeps({
			setSourceMetadata: vi.fn(async () => {
				throw new Error('disk full');
			})
		});

		await expect(
			commitIngest('sha', 'p.pdf', [chunk('body')], [[0.1]], { ...resolved, via: 'legacy' }, deps)
		).rejects.toThrow('disk full');

		expect(deps.markLegacyConsumed).not.toHaveBeenCalled();
	});

	it('does not consume anything for a source resolved another way', async () => {
		const { deps } = recordingDeps();

		await commitIngest('sha', 'p.pdf', [chunk('body')], [[0.1]], resolved, deps);

		expect(deps.markLegacyConsumed).not.toHaveBeenCalled();
	});

	it('stores chunks for a source whose metadata never resolved', async () => {
		// An unresolved source is still searchable. It just cannot be cited yet,
		// which is what the "needs attention" list is for.
		const { calls, deps } = recordingDeps();

		await commitIngest('sha', 'p.pdf', [chunk('body')], [[0.1]], undefined, deps);

		expect(calls).toEqual(['storeChunks']);
	});

	it('refuses to store a mismatched embedding batch', async () => {
		// Zipping by index would pair one chunk's text with another's page and
		// section, so a citation would point at the wrong place in the PDF.
		const { deps } = recordingDeps();

		await expect(
			commitIngest('sha', 'p.pdf', [chunk('one'), chunk('two')], [[0.1]], undefined, deps)
		).rejects.toThrow('1 vectors for 2 chunks');

		expect(deps.storeChunks).not.toHaveBeenCalled();
	});

	it('carries page and section through to storage', async () => {
		// These are what let a result say "p. 4, Results" and jump to the passage.
		const { deps } = recordingDeps();

		await commitIngest('sha', 'p.pdf', [chunk('body', 4)], [[0.1, 0.2]], undefined, deps);

		expect(deps.storeChunks).toHaveBeenCalledWith('sha', [
			{
				text: 'body',
				embedding: [0.1, 0.2],
				page_start: 4,
				page_end: 4,
				section: 'Results',
				char_start: 0,
				char_end: 4
			}
		]);
	});
});
