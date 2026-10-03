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
	error?: string | null;
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

	// M0-3 AC-3: without a style, a new citation still reads as something, not
	// as an empty span nobody can see.
	it('labels a citation by author and year when no style is loaded', () => {
		setCitationStore({
			engine: null,
			citationSources: fakeCitationSources,
			bibliography: [],
			missingIds: [],
			error: 'No style'
		});

		expect(citationStore.previewCitation(['1'])).toBe('(Smith, n.d.)');
	});

	// M0-3 AC-3: a stored style citeproc rejects names the style and the remedy.
	it('says which style failed and to choose another when citeproc rejects it', async () => {
		const citeproc = (await import('citeproc')).default as unknown as { Engine: MockInstance };
		citeproc.Engine.mockImplementationOnce(() => {
			throw new Error('bad style');
		});
		const values: Record<string, string> = {
			cslXml: '<style/>',
			localeXml: '<locale/>',
			selectedStyle: 'Journal of Examples'
		};
		(pluginStore.load as unknown as MockInstance).mockResolvedValue({
			get: vi.fn(async (key: string) => values[key])
		});
		(projectSources as unknown as MockInstance).mockResolvedValue([]);

		await expect(citationStore.initializeCitationStore()).resolves.toBe(false);
		expect(get(citationStore).error).toBe(
			'"Journal of Examples" could not be used (bad style). Choose another style in Settings.'
		);
	});

	// M0-3 AC-2/AC-3: a failure is recorded rather than thrown, so the editor
	// that awaits this still opens.
	it('records why citations cannot be formatted instead of throwing', async () => {
		const fakeStore = { get: vi.fn(() => undefined) };
		(pluginStore.load as unknown as MockInstance).mockResolvedValue(fakeStore);
		(projectSources as unknown as MockInstance).mockResolvedValue([
			{
				sha256: 'hash1',
				file_name: 'f',
				csl_json: JSON.stringify(fakeCitationItem),
				state: 'ready'
			}
		]);

		// No bundled files are reachable in this test, so setup must fail cleanly.
		await expect(citationStore.initializeCitationStore()).resolves.toBe(false);
		const value = get(citationStore);
		expect(value.engine).toBeNull();
		expect(value.error).toEqual(expect.any(String));
		// The sources are kept, so citations still get readable labels.
		expect(value.citationSources['hash1']).toMatchObject({ title: 'Test Book' });
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

	it('clears the bibliography when the last citation is deleted', () => {
		// Only renderDocument publishes to the store, so returning early on an
		// empty document left the previous bibliography and missing-source
		// markers on screen for a manuscript that no longer cites anything.
		withEngine();
		citationStore.renderDocument([{ pos: 0, itemIds: ['1'] }]);
		expect(get(citationStore).bibliography).not.toEqual([]);

		citationStore.renderDocument([]);

		expect(get(citationStore).bibliography).toEqual([]);
		expect(get(citationStore).missingIds).toEqual([]);
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

// M1a-8 AC-6, UX-12: sources the manuscript brings with it.
describe('sources the manuscript carries', () => {
	const library = [
		{
			sha256: 'hash1',
			file_name: 'mine.pdf',
			csl_json: JSON.stringify(fakeCitationItem),
			state: 'ready'
		}
	];
	const carried = {
		hash1: { ...fakeCitationItem, title: 'The co-author’s older copy' },
		hash2: { id: 'hash2', type: 'book', title: 'A book I don’t have' }
	};

	async function initialise(sources = library) {
		const fakeStore = { get: vi.fn(async () => undefined) };
		(pluginStore.load as unknown as MockInstance).mockResolvedValue(fakeStore);
		(projectSources as unknown as MockInstance).mockResolvedValue(sources);
		await citationStore.initializeCitationStore();
	}

	it('renders the ones the library lacks, marked away; the library wins for the rest', async () => {
		await initialise();
		citationStore.setManuscriptSources(carried);

		const { citationSources, awayIds } = get(citationStore);
		expect(awayIds).toEqual(['hash2']);
		expect(citationSources.hash1.title).toBe('Test Book');
		expect(citationSources.hash2.title).toBe('A book I don’t have');
		expect(citationStore.isAway('hash2')).toBe(true);
		expect(citationStore.isAway('hash1')).toBe(false);
	});

	it('goes when another manuscript opens', async () => {
		await initialise();
		citationStore.setManuscriptSources(carried);
		citationStore.setManuscriptSources({});

		expect(get(citationStore).awayIds).toEqual([]);
		expect(get(citationStore).citationSources).not.toHaveProperty('hash2');
	});

	it('stays through a reload of the library, until the library has the source', async () => {
		await initialise();
		citationStore.setManuscriptSources(carried);

		await initialise();
		expect(get(citationStore).awayIds).toEqual(['hash2']);

		// Added to the library: now it's the library's copy, and not away.
		await initialise([
			...library,
			{ sha256: 'hash2', file_name: '', csl_json: JSON.stringify(carried.hash2), state: 'ready' }
		]);
		expect(get(citationStore).awayIds).toEqual([]);
		expect(get(citationStore).citationSources.hash2.title).toBe('A book I don’t have');
		citationStore.setManuscriptSources({});
	});
});
