// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve } from 'node:path';
import JSZip from 'jszip';
import type { JSONContent } from '@tiptap/core';

import { CitationEngine } from '$lib/citations/engine';
import { renderDocumentCitations, type CitationSite } from '$lib/citations/document';
import { DEFAULT_PAGE_SETUP, toDocxPageSetup } from '$lib/editor/pagination/paper';
import type { CitationItem } from '$lib/stores/citationStore';

import { toDocx, type DocxOptions } from './docx';

const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/csl', import.meta.url));
const read = (p: string) => readFileSync(resolve(FIXTURES, p), 'utf8');
const sources = JSON.parse(read('sources.json')) as Record<string, CitationItem>;
const enUS = read('locales/locales-en-US.xml');

const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const para = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const text = (t: string, marks?: JSONContent['marks']): JSONContent => ({
	type: 'text',
	text: t,
	marks
});
const heading = (level: number, t: string): JSONContent => ({
	type: 'heading',
	attrs: { level },
	content: [text(t)]
});
const item = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content });

/** The parts of the file a person would read, unzipped. */
async function parts(bytes: Uint8Array) {
	const zip = await JSZip.loadAsync(bytes);
	const part = async (name: string) => (await zip.file(name)?.async('string')) ?? '';
	const headers = await Promise.all(
		Object.keys(zip.files)
			.filter((name) => /^word\/(header|footer)\d*\.xml$/.test(name))
			.sort()
			.map(part)
	);
	return {
		files: Object.keys(zip.files),
		document: await part('word/document.xml'),
		footnotes: await part('word/footnotes.xml'),
		numbering: await part('word/numbering.xml'),
		styles: await part('word/styles.xml'),
		headers: headers.join('\n')
	};
}

const word = async (content: JSONContent, options?: DocxOptions) =>
	parts(await toDocx(content, options));

/** The document's words, without the markup: what someone reading it sees. */
const words = (xml: string) =>
	[...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');

describe('M5-5 AC-1: a pure function from doc to bytes', () => {
	it('writes a Word file from a document', async () => {
		const bytes = await toDocx(doc(para(text('Hello.'))));

		// A .docx is a zip: "PK".
		expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
		expect(words((await parts(bytes)).document)).toBe('Hello.');
	});

	it('writes an empty document Word will still open', async () => {
		const { document } = await word(doc());

		expect(document).toContain('<w:body><w:p/>');
	});

	it('is loaded only when someone exports, never with the editor', () => {
		// `docx` is about 100 KB gzipped: a static import anywhere would put it
		// in the editor's chunk for everyone who never exports to Word.
		const src = fileURLToPath(new URL('../..', import.meta.url));
		const files = (dir: string): string[] =>
			readdirSync(dir).flatMap((name) => {
				const path = join(dir, name);
				return statSync(path).isDirectory() ? files(path) : [path];
			});
		const staticImports = files(src)
			.filter((path) => /\.(ts|svelte)$/.test(path) && !/\.test\.ts$/.test(path))
			.filter((path) => !path.endsWith(join('export', 'docx.ts')))
			.filter((path) =>
				/^\s*import\s[^;]*from\s+['"](docx|\$lib\/export\/docx|\.\/docx)['"]/m.test(
					readFileSync(path, 'utf8').replace(/import\s+type\s[^;]*;/g, '')
				)
			)
			.map((path) => relative(src, path));

		expect(staticImports).toEqual([]);
	});
});

describe('M5-5 AC-2: the manuscript mapped', () => {
	it('maps headings to Word’s heading styles', async () => {
		const { document } = await word(doc(heading(1, 'Introduction'), heading(3, 'Sites')));

		expect(document).toContain('<w:pStyle w:val="Heading1"/>');
		expect(document).toContain('<w:pStyle w:val="Heading3"/>');
	});

	it('styles the headings, so they don’t read as body text', async () => {
		const { styles } = await word(doc(heading(1, 'Introduction')));
		const heading1 = /<w:style [^>]*w:styleId="Heading1"[\s\S]*?<\/w:style>/.exec(styles)?.[0];

		expect(heading1).toContain('<w:b/>');
		expect(heading1).toContain('<w:keepNext/>');
	});

	it('carries marks and links', async () => {
		const { document } = await word(
			doc(
				para(
					text('bold', [{ type: 'bold' }]),
					text('it', [{ type: 'italic' }]),
					text('x', [{ type: 'superscript' }]),
					text('DOI', [{ type: 'link', attrs: { href: 'https://doi.org/10.1/x' } }])
				)
			)
		);

		expect(document).toMatch(/<w:b\/>[\s\S]*<w:t[^>]*>bold</);
		expect(document).toMatch(/<w:i\/>[\s\S]*<w:t[^>]*>it</);
		expect(document).toContain('<w:vertAlign w:val="superscript"/>');
		expect(document).toMatch(/<w:hyperlink [^>]*r:id="[^"]+"[^>]*>[\s\S]*DOI/);
	});

	it('numbers lists with Word’s numbering, each ordered list from its own start', async () => {
		const { document, numbering } = await word(
			doc(
				{ type: 'bulletList', content: [item(para(text('one')))] },
				{ type: 'orderedList', content: [item(para(text('first')))] },
				{
					type: 'orderedList',
					attrs: { start: 4 },
					content: [
						item(para(text('fourth')), {
							type: 'bulletList',
							content: [item(para(text('nested')))]
						})
					]
				}
			)
		);

		const numIds = [...document.matchAll(/<w:ilvl w:val="(\d)"\/><w:numId w:val="(\d+)"\/>/g)];
		expect(numIds.map((m) => m[1])).toEqual(['0', '0', '0', '1']);
		// The two ordered lists don't share a numbering, so the second doesn't
		// carry on from the first.
		expect(new Set(numIds.map((m) => m[2])).size).toBe(3);
		expect(numbering).toContain('<w:start w:val="4"/>');
		expect(numbering).toContain('<w:numFmt w:val="decimal"/>');
		expect(numbering).toContain('<w:numFmt w:val="bullet"/>');
	});

	it('writes tables, the header row repeating on each page', async () => {
		const cell = (type: string, t: string, attrs = {}) => ({
			type,
			attrs,
			content: [para(text(t))]
		});
		const { document } = await word(
			doc({
				type: 'table',
				content: [
					{ type: 'tableRow', content: [cell('tableHeader', 'Site'), cell('tableHeader', 'n')] },
					{ type: 'tableRow', content: [cell('tableCell', 'Both', { colspan: 2 })] }
				]
			})
		);

		expect(document).toContain('<w:tblHeader/>');
		expect(document).toContain('<w:gridSpan w:val="2"/>');
		expect(words(document)).toBe('SitenBoth');
	});

	it('embeds images, no wider than the text, and names one it couldn’t read', async () => {
		// The smallest PNG there is: one transparent pixel.
		const png = Uint8Array.from(
			atob(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
			),
			(c) => c.charCodeAt(0)
		);
		const { document, files } = await word(
			doc(
				{ type: 'image', attrs: { src: 'asset://figure.png', alt: 'Figure 1' } },
				{ type: 'image', attrs: { src: 'asset://gone.png', alt: 'Figure 2' } }
			),
			{ images: { 'asset://figure.png': { data: png, type: 'png', width: 2000, height: 1000 } } }
		);

		expect(files.some((name) => name.startsWith('word/media/'))).toBe(true);
		// 6.5in of text at 96dpi is 624px, so 2000 × 1000 draws at 624 × 312:
		// 9525 EMU to the pixel.
		expect(document).toContain(`cx="${624 * 9525}" cy="${312 * 9525}"`);
		expect(document).toContain('descr="Figure 1"');
		expect(words(document)).toContain('[Figure 2]');
	});

	it('sets up the page as the author did: paper, margins and spacing', async () => {
		const { document, styles } = await word(doc(para(text('x'))), {
			page: toDocxPageSetup({
				...DEFAULT_PAGE_SETUP,
				paper: 'a4',
				margin: 'wide',
				spacing: 'double'
			})
		});

		expect(document).toContain('<w:pgSz w:w="11906" w:h="16838"');
		expect(document).toMatch(/<w:pgMar w:top="2160" w:right="2160" w:bottom="2160" w:left="2160"/);
		expect(styles).toMatch(/<w:docDefaults>[\s\S]*<w:spacing [^>]*w:line="480"/);
	});

	it('writes the running heads, with the page number as Word’s own field', async () => {
		const { document, headers } = await word(doc(para(text('x'))), {
			page: toDocxPageSetup({
				...DEFAULT_PAGE_SETUP,
				firstPageBare: true,
				runningHeads: {
					headerLeft: 'COASTAL EROSION',
					headerRight: '',
					footerLeft: '',
					footerRight: 'Page {page} of {total}'
				}
			})
		});

		expect(words(headers)).toContain('COASTAL EROSION');
		expect(headers).toContain('PAGE');
		expect(headers).toContain('NUMPAGES');
		expect(words(headers)).toContain('Page  of ');
		// The first page bare: a title page.
		expect(document).toContain('<w:titlePg/>');
	});

	it('leaves the page bare when there are no running heads', async () => {
		const { headers } = await word(doc(para(text('x'))), {
			page: toDocxPageSetup({
				...DEFAULT_PAGE_SETUP,
				runningHeads: { headerLeft: '', headerRight: '', footerLeft: '', footerRight: '' }
			})
		});

		expect(headers).toBe('');
	});

	it('writes an in-text citation as its rendered text, italics included', async () => {
		const { document } = await word(
			doc(
				para(text('As shown '), {
					type: 'citation',
					attrs: { id: '["a"]', label: '(Smith, <i>Coasts</i>, 2020)', noteIndex: 0 }
				})
			)
		);

		expect(words(document)).toBe('As shown (Smith, Coasts, 2020)');
		expect(document).toMatch(/<w:i\/>[\s\S]*<w:t[^>]*>Coasts</);
		expect(document).not.toContain('footnoteReference');
	});

	it('makes a note style’s citations Word footnotes', async () => {
		const { document, footnotes } = await word(
			doc(
				para(
					text('As argued'),
					{ type: 'citation', attrs: { id: '["a"]', label: '1', noteIndex: 1 } },
					text(' and again'),
					{ type: 'citation', attrs: { id: '["a"]', label: '2', noteIndex: 2 } }
				),
				// The editor's endnotes don't print a second time.
				{ type: 'notes', attrs: { notes: [{ index: 1, text: 'Smith, <i>Coasts</i>.' }] } }
			),
			{
				notes: [
					{ index: 1, text: 'Alice Smith, <i>Coasts</i> (2020), 12.' },
					{ index: 2, text: 'Smith, <i>Coasts</i>, 14.' }
				]
			}
		);

		expect(document).toContain('<w:footnoteReference w:id="1"/>');
		expect(document).toContain('<w:footnoteReference w:id="2"/>');
		expect(words(document)).toBe('As argued and again');
		expect(words(footnotes)).toContain('Alice Smith, Coasts (2020), 12.');
		expect(words(footnotes)).toContain('Smith, Coasts, 14.');
	});

	it('reads the notes from the notes section when it isn’t given them', async () => {
		const { footnotes } = await word(
			doc(para({ type: 'citation', attrs: { id: '["a"]', label: '1', noteIndex: 1 } }), {
				type: 'notes',
				attrs: { notes: [{ index: 1, text: 'Smith, Coasts.' }] }
			})
		);

		expect(words(footnotes)).toContain('Smith, Coasts.');
	});

	it('decodes what citeproc escapes', async () => {
		const { document } = await word(
			doc(
				para({
					type: 'citation',
					attrs: { label: '(Smith &#38; Okafor, 2019&#8211;2020)', noteIndex: 0 }
				})
			)
		);

		expect(words(document)).toBe('(Smith &amp; Okafor, 2019–2020)');
	});
});

// --- AC-3: golden files ------------------------------------------------------

const STYLES = [
	'apa',
	'chicago-author-date',
	'chicago-notes-bibliography',
	'harvard-cite-them-right',
	'ieee'
];

/**
 * One manuscript with most of what a paper has, cited the ways papers cite:
 * two same-author same-year works, a page, two works at once, a repeat.
 */
const CITED: { ids: string[]; locators?: Record<string, string> }[] = [
	{ ids: ['smith-2020-a'] },
	{ ids: ['smith-2020-b'], locators: { 'smith-2020-b': '57' } },
	{ ids: ['okafor-2019', 'tanaka-2021-book'] },
	{ ids: ['smith-2020-a'] }
];

function manuscript(style: string) {
	const engine = new CitationEngine({
		styleXml: read(`styles/${style}.csl`),
		localeXml: enUS,
		sources
	});
	const sites: CitationSite[] = CITED.map((c, i) => ({
		pos: i,
		itemIds: c.ids,
		locators: c.locators
	}));
	const rendered = renderDocumentCitations(sites, engine, new Set(Object.keys(sources)));
	const cite = (i: number): JSONContent => ({
		type: 'citation',
		attrs: {
			id: JSON.stringify(CITED[i].ids),
			locators: CITED[i].locators ?? null,
			label: rendered.sites[i].label,
			noteIndex: rendered.sites[i].noteIndex
		}
	});

	return {
		notes: rendered.notes,
		doc: doc(
			heading(1, 'Shoreline change in three estuaries'),
			para(
				text('Erosion has accelerated '),
				cite(0),
				text(', though sediment supply varies '),
				cite(1),
				text('.')
			),
			heading(2, 'Method'),
			para(
				text('Two earlier surveys '),
				cite(2),
				text(' set the baseline; we follow the first '),
				cite(3),
				text('.')
			),
			{
				type: 'orderedList',
				content: [item(para(text('Survey the sites.'))), item(para(text('Model the transport.')))]
			},
			{
				type: 'table',
				content: [
					{
						type: 'tableRow',
						content: [
							{ type: 'tableHeader', content: [para(text('Site'))] },
							{ type: 'tableHeader', content: [para(text('Retreat (m)'))] }
						]
					},
					{
						type: 'tableRow',
						content: [
							{ type: 'tableCell', content: [para(text('Severn'))] },
							{ type: 'tableCell', content: [para(text('4.2'))] }
						]
					}
				]
			},
			{ type: 'notes', attrs: { notes: rendered.notes } },
			{ type: 'bibliography', attrs: { entries: rendered.bibliography, missing: 0 } }
		)
	};
}

/** One element a line, so a golden diff points at what changed. */
const lines = (xml: string) => xml.replace(/></g, '>\n<') + '\n';

describe('M5-5 AC-3: golden files for the five vendored styles', () => {
	for (const style of STYLES) {
		it(`writes ${style} as it did`, async () => {
			const { doc: content, notes } = manuscript(style);
			const { document, footnotes } = await word(content, {
				notes,
				page: toDocxPageSetup(DEFAULT_PAGE_SETUP)
			});

			await expect(lines(document)).toMatchFileSnapshot(`__golden__/docx/${style}.document.xml`);
			await expect(lines(footnotes)).toMatchFileSnapshot(`__golden__/docx/${style}.footnotes.xml`);
		});
	}

	it('gives the note style footnotes and the others none', async () => {
		for (const style of STYLES) {
			const { doc: content, notes } = manuscript(style);
			const { document } = await word(content, { notes });
			expect(document.includes('footnoteReference'), style).toBe(
				style === 'chicago-notes-bibliography'
			);
		}
	});
});
