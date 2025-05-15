import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileSystemStore, fileSystemState } from './fileSystem.svelte';
import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  fileSystemStore.set({ items: [], currentPath: '', loading: false, error: null });
  fileSystemState.currentFile = null;
  mockInvoke.mockReset();
});

describe('fileSystemStore', () => {
  it('has initial state', () => {
    const value = get(fileSystemStore);
    expect(value).toEqual({ items: [], currentPath: '', loading: false, error: null });
    expect(fileSystemState.currentFile).toBe(null);
  });

  it('reads directory successfully', async () => {
    const fakeItems = [
      { name: 'file.txt', path: '/file.txt', is_dir: false },
      { name: 'folder', path: '/folder', is_dir: true }
    ];
    mockInvoke.mockResolvedValue(fakeItems);
    await fileSystemStore.readDirectory('/');
    const value = get(fileSystemStore);
    expect(value.items).toEqual(fakeItems);
    expect(value.currentPath).toBe('/');
    expect(value.loading).toBe(false);
    expect(value.error).toBe(null);
  });

  it('handles readDirectory error', async () => {
    mockInvoke.mockRejectedValue(new Error('fail'));
    await fileSystemStore.readDirectory('/bad');
    const value = get(fileSystemStore);
    expect(value.error).toBe('fail');
    expect(value.loading).toBe(false);
  });

  it('clears error', () => {
    fileSystemStore.set({ items: [], currentPath: '', loading: false, error: 'fail' });
    fileSystemStore.clearError();
    const value = get(fileSystemStore);
    expect(value.error).toBe(null);
  });

  it('updates currentFile in $state', () => {
    expect(fileSystemState.currentFile).toBe(null);
    fileSystemState.currentFile = '/foo.txt';
    expect(fileSystemState.currentFile).toBe('/foo.txt');
  });
});
