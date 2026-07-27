import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const db = await import('./db');

/**
 * The client is a thin typed layer over named Rust commands, so what can
 * actually break here is a wrong command name or a mis-shaped argument object —
 * both of which only surface at runtime, as an opaque IPC error.
 *
 * The behaviour of the queries themselves is covered in
 * src-tauri/tests/hybrid_data_model.rs, against real databases rather than mocks.
 *
 * This replaces the old tests for `executeQuery`/`isReadQuery`. That routing was
 * a real bug — `INSERT INTO chunks SELECT ...` matched "select" and was sent to
 * db.select — but it is now structurally impossible: the frontend cannot send
 * SQL at all.
 */

beforeEach(() => {
	invoke.mockReset();
	invoke.mockResolvedValue(undefined);
});

describe('database client', () => {
	it('names arguments as the Rust commands expect', async () => {
		await db.openLibrary('/home/me/Erti/library.db');
		expect(invoke).toHaveBeenCalledWith('open_library', { path: '/home/me/Erti/library.db' });

		await db.openProject('/home/me/thesis');
		expect(invoke).toHaveBeenCalledWith('open_project', { root: '/home/me/thesis' });

		await db.hashFile('/a/paper.pdf');
		expect(invoke).toHaveBeenCalledWith('hash_file', { path: '/a/paper.pdf' });

		await db.registerSource('abc123', '/a/paper.pdf', 'paper.pdf');
		expect(invoke).toHaveBeenCalledWith('register_source', {
			sha256: 'abc123',
			path: '/a/paper.pdf',
			fileName: 'paper.pdf'
		});

		await db.addToProject('abc123');
		expect(invoke).toHaveBeenCalledWith('add_to_project', { sha256: 'abc123' });

		await db.setMetadataOverride('abc123', '{"title":"x"}');
		expect(invoke).toHaveBeenCalledWith('set_metadata_override', {
			sha256: 'abc123',
			cslJson: '{"title":"x"}'
		});
	});

	it('sends chunks with their embeddings intact', async () => {
		await db.storeChunks('abc123', [
			{ text: 'a sentence', embedding: [0.1, 0.2], page_start: 3, section: 'Methods' }
		]);

		expect(invoke).toHaveBeenCalledWith('store_chunks', {
			sha256: 'abc123',
			chunks: [{ text: 'a sentence', embedding: [0.1, 0.2], page_start: 3, section: 'Methods' }]
		});
	});

	it('defaults search to the project and can widen to the library', async () => {
		invoke.mockResolvedValue([]);

		await db.searchSources('a claim to support');
		expect(invoke).toHaveBeenCalledWith('search_sources', {
			query: 'a claim to support',
			limit: undefined,
			includeLibrary: undefined
		});

		await db.searchSources('a claim', { limit: 10, includeLibrary: true });
		expect(invoke).toHaveBeenCalledWith('search_sources', {
			query: 'a claim',
			limit: 10,
			includeLibrary: true
		});
	});

	it('surfaces backend failures rather than swallowing them', async () => {
		invoke.mockRejectedValue(new Error('library is not open'));

		await expect(db.projectSources()).rejects.toThrow('library is not open');
	});
});
