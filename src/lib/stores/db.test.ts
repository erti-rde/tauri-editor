import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dbStore, isReadQuery } from './db';
import type Database from '@tauri-apps/plugin-sql';

// Mock Database implementation with required properties
const mockSelect = vi.fn();
const mockExecute = vi.fn();
const mockDb: Database = {
	select: mockSelect,
	execute: mockExecute,
	path: 'mock-path',
	close: vi.fn()
};

type StoreValue = {
	db: Database | null;
	isLoading: boolean;
	error: Error | null;
};

beforeEach(() => {
	mockSelect.mockReset();
	mockExecute.mockReset();
	dbStore.reset();
});

describe('dbStore', () => {
	it('sets the database instance', () => {
		dbStore.setDb(mockDb);
		let value: StoreValue = { db: null, isLoading: false, error: null };
		dbStore.subscribe((v) => (value = v))();
		expect(value.db).toBe(mockDb);
		expect(value.isLoading).toBe(false);
	});

	it('executes a SELECT query', async () => {
		dbStore.setDb(mockDb);
		mockSelect.mockResolvedValue([{ id: 1 }]);
		const result = await dbStore.executeQuery('SELECT * FROM test');
		expect(mockSelect).toHaveBeenCalledWith('SELECT * FROM test', undefined);
		expect(result).toEqual([{ id: 1 }]);
	});

	it('executes a non-SELECT query', async () => {
		dbStore.setDb(mockDb);
		mockExecute.mockResolvedValue({ success: true });
		const result = await dbStore.executeQuery('INSERT INTO test VALUES (1)');
		expect(mockExecute).toHaveBeenCalledWith('INSERT INTO test VALUES (1)', undefined);
		expect(result).toEqual({ success: true });
	});

	it('throws if db is not initialized', async () => {
		await expect(dbStore.executeQuery('SELECT * FROM test')).rejects.toThrow(
			'Database not initialized'
		);
	});

	it('sets error state', () => {
		const error = new Error('fail');
		dbStore.setError(error);
		let value: StoreValue = { db: null, isLoading: false, error: null };
		dbStore.subscribe((v) => (value = v))();
		expect(value.error).toBe(error);
		expect(value.isLoading).toBe(false);
	});

	it('sets loading state', () => {
		dbStore.setLoading(true);
		let value: StoreValue = { db: null, isLoading: false, error: null };
		dbStore.subscribe((v) => (value = v))();
		expect(value.isLoading).toBe(true);
	});

	it('resets the store', () => {
		dbStore.setDb(mockDb);
		dbStore.setError(new Error('fail'));
		dbStore.setLoading(true);
		dbStore.reset();
		let value: StoreValue = { db: null, isLoading: false, error: null };
		dbStore.subscribe((v) => (value = v))();
		expect(value.db).toBe(null);
		expect(value.isLoading).toBe(false);
		expect(value.error).toBe(null);
	});
});

describe('statement routing', () => {
	// Routing used to be `query.toLowerCase().includes('select')`, which sends
	// writes to db.select. That either errors or silently discards the write.
	const reads = [
		'SELECT * FROM files',
		'  select id from chunks',
		'\n\tSELECT 1',
		'-- a leading comment\nSELECT * FROM files',
		'/* block */ SELECT * FROM files',
		'PRAGMA foreign_keys = ON',
		'EXPLAIN QUERY PLAN SELECT * FROM files',
		'WITH recent AS (SELECT * FROM files) SELECT * FROM recent'
	];

	const writes = [
		'INSERT INTO files (file_name) VALUES (?)',
		'INSERT INTO chunks (file_id, chunk_text) SELECT id, name FROM files',
		'UPDATE selections SET x = 1',
		'DELETE FROM files WHERE id = ?',
		'INSERT OR REPLACE INTO source_metadata (file_id, metadata) VALUES (?, ?)',
		'CREATE TABLE selected_items (id INTEGER)',
		'WITH doomed AS (SELECT id FROM files) DELETE FROM chunks WHERE file_id IN (SELECT id FROM doomed)'
	];

	it.each(reads)('treats %j as a read', (query) => {
		expect(isReadQuery(query)).toBe(true);
	});

	it.each(writes)('treats %j as a write', (query) => {
		expect(isReadQuery(query)).toBe(false);
	});

	it('routes a write containing SELECT to execute, not select', async () => {
		dbStore.setDb(mockDb);
		mockExecute.mockResolvedValue({ rowsAffected: 3 });

		await dbStore.executeQuery('INSERT INTO chunks (file_id) SELECT id FROM files');

		expect(mockExecute).toHaveBeenCalledTimes(1);
		expect(mockSelect).not.toHaveBeenCalled();
	});

	it('routes a query against a table named selections to execute', async () => {
		dbStore.setDb(mockDb);
		mockExecute.mockResolvedValue({ rowsAffected: 1 });

		await dbStore.executeQuery('UPDATE selections SET chosen = 1');

		expect(mockExecute).toHaveBeenCalledTimes(1);
		expect(mockSelect).not.toHaveBeenCalled();
	});
});
