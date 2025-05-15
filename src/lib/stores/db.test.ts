import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dbStore } from './db';
import type Database from '@tauri-apps/plugin-sql';

// Mock Database implementation with required properties
const mockSelect = vi.fn();
const mockExecute = vi.fn();
const mockDb: Database = {
  select: mockSelect,
  execute: mockExecute,
  path: 'mock-path',
  close: vi.fn(),
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
    await expect(dbStore.executeQuery('SELECT * FROM test')).rejects.toThrow('Database not initialized');
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
