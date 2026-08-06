import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { citationStore } from './citationStore';
import { CitationEngine } from '$lib/citations/engine';
import { get } from 'svelte/store';
import * as pluginStore from '@tauri-apps/plugin-store';
import { projectSources } from '$lib/stores/db';
import type { CitationItem } from './citationStore';

// Mock dependencies
vi.mock('@tauri-apps/plugin-store', () => ({
	load: vi.fn()
}));

vi.mock('$lib/stores/db', () => ({
	projectSources: vi.fn()
}));

// The store now drives citeproc through CitationEngine, which replaces the
// processor's whole citation state rather than formatting clusters one at a
// time. The mock mirrors that surface.
vi.mock('citeproc', () => {
	return {
		default: {
			Engine: vi.fn().mockImplementation(() => ({
				updateItems: vi.fn(),
				rebuildProcessorState: vi.fn((citations: Array<{ citationID: string }>) =>
					citations.map((c, i) => [c.citationID, i + 1, '(Smith, 2020)'])
				),
				makeBibliography: vi.fn(() => [null, ['Bibliography Entry']])
			}))
		}
	};
});

// A source's citation id is now the SHA-256 of its file, so one paper keeps the
// same identity across every project that cites it.
const fakeCitationItem: CitationItem = {
	id: 'hash1',
	type: 'book',
	title: 'Test Book',
	author: [{ family: 'Smith', given: 'John' }]
};

const fakeCitationSources = {
	'1': fakeCitationItem
};

type CitationState = {
	engine: CitationEngine | null;
	citationSources: Record<string, CitationItem>;
	bibliography: string[];
	missingIds: string[];
};

const engineWith = (sources: Record<string, CitationItem>) =>
	new CitationEngine({ styleXml: '', localeXml: '', sources });

const withEngine = (sources = fakeCitationSources) =>
	setCitationStore({
		engine: engineWith(sources),
		citationSources: sources,
		bibliography: [],
		missingIds: []
	});
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
			get: vi
				.fn()
				.mockImplementationOnce(() => '<style-xml/>')
				.mockImplementationOnce(() => '<locale-xml/>')
		};
		(pluginStore.load as unknown as MockInstance).mockResolvedValue(fakeStore);
		(projectSources as unknown as MockInstance).mockResolvedValue([
			{
				sha256: 'hash1',
				file_name: 'file1',
				csl_json: JSON.stringify(fakeCitationItem),
				state: 'ready'
			}
		]);

		await citationStore.initializeCitationStore();
		const value = get(citationStore);
		expect(value.engine).not.toBe(null);
		expect(value.citationSources['hash1']).toMatchObject(fakeCitationItem);
	});

	it('getAllSourcesAsJson returns sources', async () => {
		// Use initializeCitationStore to set up state
		const fakeStore = {
			get: vi
				.fn()
				.mockImplementationOnce(() => '<style-xml/>')
				.mockImplementationOnce(() => '<locale-xml/>')
		};
		(pluginStore.load as unknown as MockInstance).mockResolvedValue(fakeStore);
		(projectSources as unknown as MockInstance).mockResolvedValue([
			{
				sha256: 'hash1',
				file_name: 'file1',
				csl_json: JSON.stringify(fakeCitationItem),
				state: 'ready'
			}
		]);
		await citationStore.initializeCitationStore();
		expect(citationStore.getAllSourcesAsJson()).toHaveProperty('hash1');
	});

	it('previews a single citation before it is inserted', () => {
		withEngine();

		expect(citationStore.previewCitation(['1'])).toBe('(Smith, 2020)');
	});

	it('previews nothing before the engine exists', () => {
		setCitationStore({
			engine: null,
			citationSources: fakeCitationSources,
			bibliography: [],
			missingIds: []
		});

		expect(citationStore.previewCitation(['1'])).toBe('');
	});

	it('previews nothing for a source that is not in the library', () => {
		// Handing citeproc an unresolvable id throws inside the processor.
		withEngine();

		expect(citationStore.previewCitation(['2'])).toBe('');
	});

	it('renders a document and publishes its bibliography', () => {
		withEngine();

		const rendered = citationStore.renderDocument([{ pos: 0, itemIds: ['1'] }]);

		expect(rendered?.sites[0].label).toBe('(Smith, 2020)');
		expect(get(citationStore).bibliography).toContain('Bibliography Entry');
	});

	it('reports a cited source that no longer exists', () => {
		withEngine();

		const rendered = citationStore.renderDocument([{ pos: 0, itemIds: ['gone'] }]);

		expect(rendered?.missingIds).toEqual(['gone']);
		expect(get(citationStore).missingIds).toEqual(['gone']);
	});

	it('renders nothing when no style has been loaded', () => {
		setCitationStore({
			engine: null,
			citationSources: fakeCitationSources,
			bibliography: [],
			missingIds: []
		});

		expect(citationStore.renderDocument([{ pos: 0, itemIds: ['1'] }])).toBeNull();
	});
});
