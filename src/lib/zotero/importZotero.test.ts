import { describe, expect, it, vi } from 'vitest';

import { useFakeBackend } from '$lib/harness/testing';
import { call, commands, type ZoteroPick } from '$lib/ipc';
import { augmentSchema, zoteroCslMaps } from '$lib/metadata-explorer/adapterCslZotero';
import { ImportStopped } from '$lib/metadata-explorer/bibliography';
import * as db from '$lib/stores/db';
import { importZotero, previewZotero } from './importZotero';

// The real store over the fake backend, with `importSources` there to stop.
vi.mock('$lib/stores/db', async (original) => {
	const real = await original<typeof import('$lib/stores/db')>();
	return { ...real, importSources: vi.fn(real.importSources) };
});

/**
 * Importing what's ticked in Zotero (M1b-11 AC-5, AC-6) on the fake backend:
 * every ticked paper ends up in the project with its PDFs, whether the
 * library had it, two Zotero papers are one work, or the import stops.
 */

const HAD = 'erti:00000000-0000-4000-8000-0000000000aa';
const OSTROM = '/fake/home/Zotero/storage/ATTACHB3/ostrom-1990.pdf';
const FUKUYAMA = '/fake/home/Zotero/storage/ATTACHC4/fukuyama-1995.pdf';
/** Ostrom's book, as the library would have it: matched by title, year and author. */
const GOVERNING = {
	type: 'book',
	title: 'Governing the Commons',
	issued: { 'date-parts': [[1990]] },
	author: [{ family: 'Ostrom', given: 'Elinor' }]
};
const item = (key: string): ZoteroPick => ({ library: 'user', kind: 'item', key, name: null });

describe('importZotero', () => {
	const backend = useFakeBackend();

	async function setup() {
		const state = backend().state;
		state.libraryOpen = true;
		state.root = '/fake/project';
		state.zotero.linked = state.zotero.detected;
		return { state, maps: await zoteroCslMaps(), schema: await augmentSchema() };
	}

	/** A work the library has already, from another project. */
	const libraryHas = (csl: Record<string, unknown>) =>
		call(
			commands.importSources(
				[{ id: HAD, csl_json: JSON.stringify(csl), zotero_type: String(csl.type) }],
				false
			)
		);

	/** Give a fake Zotero paper a DOI. */
	function doi(key: string, value: string) {
		const paper = backend().state.zotero.papers.find((p) => p.key === key)!;
		paper.fields.push({ name: 'DOI', base: null, value });
	}

	it('M1b-11 AC-6: a work the library had joins the project with its PDF, once', async () => {
		const { state, maps, schema } = await setup();
		await libraryHas(GOVERNING);

		const preview = await previewZotero([item('PAPERBB3')], maps);
		expect(preview.known).toHaveLength(1);
		expect(preview.pdfs).toBe(1);

		const imported = await importZotero(preview, schema);
		expect(imported.attached.map((a) => a.path)).toEqual([OSTROM]);
		expect(state.zotero.imported['user/PAPERBB3']).toBe(HAD);
		expect(state.project.has(HAD)).toBe(true);

		// Ticked again, its PDF is attached already: nothing to attach.
		const again = await previewZotero([item('PAPERBB3')], maps);
		expect(again.pdfs).toBe(0);
		expect((await importZotero(again, schema)).unattached).toEqual([]);
	});

	it('M1b-11 AC-6: two Zotero papers with one DOI are one work, with both papers’ PDFs', async () => {
		const { state, maps, schema } = await setup();
		doi('PAPERDD5', '10.1000/one');
		doi('PAPERBB3', '10.1000/one');

		// Levi first, so Ostrom is the one that repeats it, and brings a PDF.
		const preview = await previewZotero([item('PAPERDD5'), item('PAPERBB3')], maps);
		expect(preview.fresh.map((e) => e.zoteroKey)).toEqual(['PAPERDD5']);
		expect(preview.repeated.map((r) => r.entry.zoteroKey)).toEqual(['PAPERBB3']);
		expect(preview.pdfs).toBe(1);

		const imported = await importZotero(preview, schema);
		expect(imported.added).toHaveLength(1);
		const [work] = imported.added;
		expect(state.zotero.imported).toMatchObject({ 'user/PAPERDD5': work, 'user/PAPERBB3': work });
		expect(imported.attached.map((a) => a.path)).toEqual([OSTROM]);
	});

	it('M1b-11 AC-6: a paper the library gained since the preview joins as the work it is', async () => {
		const { state, maps, schema } = await setup();
		doi('PAPERCC4', '10.1000/fukuyama');
		const preview = await previewZotero([item('PAPERCC4')], maps);
		expect(preview.fresh).toHaveLength(1);

		await libraryHas({
			type: 'article-journal',
			title: 'Social capital and civil society',
			DOI: '10.1000/fukuyama'
		});
		const imported = await importZotero(preview, schema);
		expect(imported.added).toEqual([]);
		expect(state.zotero.imported['user/PAPERCC4']).toBe(HAD);
		expect(state.project.has(HAD)).toBe(true);
		expect(imported.attached.map((a) => a.path)).toEqual([FUKUYAMA]);
	});

	it('M1b-11 AC-6: an import that stops still notes, follows and attaches what it got to', async () => {
		const { state, maps, schema } = await setup();
		await libraryHas(GOVERNING);
		const thesis: ZoteroPick = {
			library: 'user',
			kind: 'collection',
			key: 'THESIS22',
			name: 'Thesis'
		};
		const preview = await previewZotero([thesis], maps);
		vi.mocked(db.importSources).mockRejectedValueOnce(new Error('The disk is full.'));

		const stopped = await importZotero(preview, schema, { follow: [thesis] }).catch((e) => e);
		expect(stopped).toBeInstanceOf(ImportStopped);
		expect((stopped as ImportStopped).imported.attached.map((a) => a.path)).toEqual([OSTROM]);
		expect(state.zotero.imported['user/PAPERBB3']).toBe(HAD);
		// Followed, so a sync brings in the rest.
		expect(state.zotero.follow).toEqual([thesis]);
		const plan = await call(commands.zoteroSyncPlan());
		expect(plan.items.map((i) => i.key)).toEqual(['PAPERCC4']);
	});
});
