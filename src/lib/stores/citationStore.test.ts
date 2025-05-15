import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { citationStore } from './citationStore';
import CSL from 'citeproc';
import { get } from 'svelte/store';
import * as pluginStore from '@tauri-apps/plugin-store';
import { dbStore } from '$lib/stores/db';
import type { CitationItem } from './citationStore';

// Mock dependencies
vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn()
}));

vi.mock('$lib/stores/db', () => ({
  dbStore: { executeQuery: vi.fn() }
}));

vi.mock('citeproc', () => {
  return {
    default: {
      Engine: vi.fn().mockImplementation(() => ({
        processCitationCluster: vi.fn(() => [null, [[null, '(Smith, 2020)']]]),
        makeBibliography: vi.fn(() => [null, ['Bibliography Entry']])
      }))
    }
  };
});

const fakeCitationItem: CitationItem = {
  id: '1',
  type: 'book',
  title: 'Test Book',
  author: [{ family: 'Smith', given: 'John' }],
};

const fakeCitationSources = {
  '1': fakeCitationItem
};

type CitationState = {
  engine: CSL.Engine | null;
  citationSources: Record<string, CitationItem>;
};
const setCitationStore = (citationStore as unknown as { set: (v: CitationState) => void }).set;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('citationStore', () => {
  it('has initial state', () => {
    const value = get(citationStore);
    expect(value.engine).toBe(null);
    expect(value.citationSources).toEqual({});
  });

  it('initializes store with initializeCitationStore', async () => {
    // Mock store and db responses
    const fakeStore = {
      get: vi.fn()
        .mockImplementationOnce(() => '<style-xml/>')
        .mockImplementationOnce(() => '<locale-xml/>')
    };
    ((pluginStore.load as unknown) as MockInstance).mockResolvedValue(fakeStore);
    ((dbStore.executeQuery as unknown) as MockInstance).mockResolvedValue([
      { id: 1, file_name: 'file1', metadata: JSON.stringify(fakeCitationItem) }
    ]);

    await citationStore.initializeCitationStore();
    const value = get(citationStore);
    expect(value.engine).not.toBe(null);
    expect(value.citationSources['1']).toMatchObject(fakeCitationItem);
  });

  it('getAllSourcesAsJson returns sources', async () => {
    // Use initializeCitationStore to set up state
    const fakeStore = {
      get: vi.fn()
        .mockImplementationOnce(() => '<style-xml/>')
        .mockImplementationOnce(() => '<locale-xml/>')
    };
    ((pluginStore.load as unknown) as MockInstance).mockResolvedValue(fakeStore);
    ((dbStore.executeQuery as unknown) as MockInstance).mockResolvedValue([
      { id: 1, file_name: 'file1', metadata: JSON.stringify(fakeCitationItem) }
    ]);
    await citationStore.initializeCitationStore();
    expect(citationStore.getAllSourcesAsJson()).toHaveProperty('1');
  });

  it('getInlineCitation returns formatted citation', () => {
    setCitationStore({
      engine: new CSL.Engine({}, ''),
      citationSources: fakeCitationSources
    });
    const result = citationStore.getInlineCitation(['1']);
    expect(result).toBe('(Smith, 2020)');
  });

  it('getInlineCitation returns error if engine not initialized', () => {
    setCitationStore({ engine: null, citationSources: fakeCitationSources });
    const result = citationStore.getInlineCitation(['1']);
    expect(result).toMatch(/engine not ready/i);
  });

  it('getInlineCitation returns error if citation not found', () => {
    setCitationStore({
      engine: new CSL.Engine({}, ''),
      citationSources: fakeCitationSources
    });
    const result = citationStore.getInlineCitation(['2']);
    expect(result).toMatch(/not found/i);
  });

  it('generateBibliography returns bibliography', () => {
    setCitationStore({
      engine: new CSL.Engine({}, ''),
      citationSources: fakeCitationSources
    });
    const result = citationStore.generateBibliography();
    expect(result).toContain('Bibliography Entry');
  });
});
