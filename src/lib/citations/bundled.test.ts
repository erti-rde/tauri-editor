import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
	bundledStyleByName,
	fallbackLabel,
	isBundledLocale,
	parseManifest,
	resolveCitationSetup,
	type BundledManifest
} from './bundled';
import { CitationEngine } from './engine';

/**
 * These tests read the real files under `src-tauri/resources/csl`, the ones the
 * app ships, so a bad download, a missing file or a style citeproc rejects fails
 * here rather than on someone's first launch.
 */
const RESOURCES = resolve(process.cwd(), 'src-tauri/resources/csl');
const read = (p: string) => readFileSync(resolve(RESOURCES, p), 'utf8');
const manifest = parseManifest(JSON.parse(read('bundled.json')));
const readResource = vi.fn(async (p: string) => read(p));
const loadManifest = async () => manifest;

const sources = JSON.parse(
	readFileSync(resolve(process.cwd(), 'tests/fixtures/csl/sources.json'), 'utf8')
);
const firstSource = Object.keys(sources)[0];

describe('the bundled styles (M0-3 AC-1)', () => {
	it('ships seven styles and English in two variants', () => {
		expect(manifest.styles.map((s) => s.id)).toEqual([
			'apa',
			'chicago-author-date',
			'chicago-notes-bibliography',
			'harvard-cite-them-right',
			'ieee',
			'modern-language-association',
			'elsevier-vancouver'
		]);
		expect(Object.keys(manifest.locales).sort()).toEqual(['en-GB', 'en-US']);
	});

	it.each(manifest.styles.map((s) => [s.label, s] as const))(
		'%s keeps its licence and renders a citation in every bundled locale',
		(_label, style) => {
			const styleXml = read(style.file);
			expect(styleXml).toContain('creativecommons.org/licenses/by-sa/3.0');
			// An independent style carries its own formatting; a dependent one would
			// need its parent, which Erti does not ship.
			expect(styleXml).not.toContain('rel="independent-parent"');

			for (const localePath of Object.values(manifest.locales)) {
				const engine = new CitationEngine({ styleXml, localeXml: read(localePath), sources });
				const [rendered] = engine.render([{ id: 'c1', itemIds: [firstSource] }]);
				expect(rendered.text.trim().length).toBeGreaterThan(0);
				expect(engine.bibliography().length).toBe(1);
			}
		}
	);
});

describe('choosing a style and locale (M0-3 AC-2)', () => {
	it('uses APA in British English on a fresh install, reading only bundled files', async () => {
		const setup = await resolveCitationSetup({}, loadManifest, readResource);

		expect(setup.styleName).toBe('APA Style 7th edition');
		expect(setup.styleIsBundled).toBe(true);
		expect(setup.locale).toBe('en-GB');
		expect(setup.styleXml).toBe(read('styles/apa.csl'));
		expect(setup.localeXml).toBe(read('locales/locales-en-GB.xml'));
	});

	it('keeps whatever Settings stored, and reads nothing', async () => {
		readResource.mockClear();
		const setup = await resolveCitationSetup(
			{
				styleXml: '<style>downloaded</style>',
				localeXml: '<locale>de</locale>',
				selectedStyle: 'Some Journal',
				selectedLocale: 'de-DE'
			},
			loadManifest,
			readResource
		);

		expect(setup).toEqual({
			styleXml: '<style>downloaded</style>',
			localeXml: '<locale>de</locale>',
			styleName: 'Some Journal',
			locale: 'de-DE',
			styleIsBundled: false
		});
		expect(readResource).not.toHaveBeenCalled();
	});

	it('keeps a stored style working even when the bundled files are damaged', async () => {
		const setup = await resolveCitationSetup(
			{ styleXml: '<style/>', localeXml: '<locale/>', selectedStyle: 'APA Style 7th edition' },
			async () => {
				throw new Error('damaged');
			},
			readResource
		);
		expect(setup.styleXml).toBe('<style/>');
		expect(setup.styleIsBundled).toBe(false);
	});

	it('uses a stored bundled locale when only the locale text is missing', async () => {
		const setup = await resolveCitationSetup(
			{ selectedLocale: 'en-US' },
			loadManifest,
			readResource
		);
		expect(setup.locale).toBe('en-US');
		expect(setup.localeXml).toBe(read('locales/locales-en-US.xml'));
	});

	it('falls back to the default locale when the stored one is not bundled', async () => {
		const setup = await resolveCitationSetup(
			{ selectedLocale: 'fr-FR' },
			loadManifest,
			readResource
		);
		expect(setup.locale).toBe('en-GB');
	});

	it('treats empty stored text as missing', async () => {
		const setup = await resolveCitationSetup(
			{ styleXml: '  ', localeXml: '' },
			loadManifest,
			readResource
		);
		expect(setup.styleIsBundled).toBe(true);
	});

	it('says which bundled file is unreadable', async () => {
		await expect(
			resolveCitationSetup({}, loadManifest, async () => 'not xml at all')
		).rejects.toThrow('The bundled style "APA 7th edition" could not be read.');
	});
});

describe('the manifest', () => {
	it('rejects a damaged manifest with a message a person can act on', () => {
		expect(() => parseManifest({})).toThrow('Reinstalling Erti will fix this.');
		expect(() => parseManifest({ ...manifest, styles: [{ id: 1 }] })).toThrow('damaged');
	});

	it('rejects a default that is not bundled', () => {
		const bad = { ...manifest, default: { style: 'nope', locale: 'en-GB' } } as BundledManifest;
		expect(() => parseManifest(bad)).toThrow('"nope" is not bundled');
	});

	it('finds bundled styles by their upstream name, and bundled locales by code', () => {
		expect(bundledStyleByName(manifest, 'IEEE Reference Guide version 11.29.2023')?.id).toBe(
			'ieee'
		);
		expect(bundledStyleByName(manifest, 'Nature')).toBeNull();
		expect(isBundledLocale(manifest, 'en-US')).toBe(true);
		expect(isBundledLocale(manifest, 'de-DE')).toBe(false);
	});
});

describe('a citation when no style can be applied (M0-3 AC-3)', () => {
	it('shows author and year rather than an identifier', () => {
		expect(
			fallbackLabel([
				{ author: [{ family: 'Vaswani', given: 'A.' }], issued: { 'date-parts': [[2017]] } },
				{ author: [{ literal: 'WHO' }], issued: { 'date-parts': [[2021, 5]] } }
			])
		).toBe('(Vaswani, 2017; WHO, 2021)');
	});

	it('falls back to the editor, then the title, then says it has no date', () => {
		expect(fallbackLabel([{ editor: [{ family: 'Ong' }] }])).toBe('(Ong, n.d.)');
		expect(fallbackLabel([{ title: 'Orality and Literacy Revisited' }])).toBe(
			'(Orality and Literacy, n.d.)'
		);
		expect(fallbackLabel([{}])).toBe('(n.d.)');
		expect(fallbackLabel([])).toBe('(citation)');
	});
});
