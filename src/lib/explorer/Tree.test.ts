import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import Tree from './Tree.svelte';

// Mock TreeItem component
vi.mock('./TreeItem.svelte', () => ({
  default: vi.fn()
}));

// Mock fileSystemStore
vi.mock('$lib/stores/fileSystem.svelte', () => ({
  fileSystemStore: {
    currentPath: '/test/path',
    subscribe: vi.fn((fn) => {
      fn({
        currentPath: '/test/path',
        items: [
          { name: 'test-file.txt', path: '/test/path/test-file.txt', is_dir: false, children: [] },
          { name: 'test-dir', path: '/test/path/test-dir', is_dir: true, children: [] }
        ],
        error: null
      });
      return { unsubscribe: vi.fn() };
    })
  }
}));

describe('Tree Component', () => {
  afterEach(() => {
    cleanup();
  });

  it('should render without errors', () => {
    const { container } = render(Tree);
    expect(container.querySelector('div')).not.toBeNull();
  });
});
