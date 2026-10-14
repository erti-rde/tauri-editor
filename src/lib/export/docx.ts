import type { JSONContent } from '@tiptap/core';
import {
	AlignmentType,
	Document,
	ExternalHyperlink,
	Footer,
	FootnoteReferenceRun,
	Header,
	HeadingLevel,
	ImageRun,
	LevelFormat,
	LineRuleType,
	Packer,
	PageBreak,
	PageNumber,
	Paragraph,
	Tab,
	TabStopType,
	Table,
	TableCell,
	TableRow,
	TextRun,
	WidthType,
	type ILevelsOptions,
	type IParagraphOptions,
	type IRunOptions,
	type ParagraphChild
} from 'docx';

import type { RenderedNote } from '$lib/citations/document';
import { BIBLIOGRAPHY_NODE } from '$lib/editor/extensions/citation/Bibliography';
import { NOTES_NODE } from '$lib/editor/extensions/citation/Notes';
import { PAGE_BREAK_NODE } from '$lib/editor/extensions/PageBreak';
import type { DocxPageSetup } from '$lib/editor/pagination/paper';

/**
 * A manuscript as a Word document (M5-5, ADR 009).
 *
 * Co-authors, supervisors and most journals still work in Word, and "can you
 * send it as a .docx?" is the question that sends a researcher back to Word
 * for good. So this is the same document the PDF is: the same page, the same
 * citations as rendered, the same references.
 *
 * Unlike the LaTeX export, citations go as rendered text. Whoever opens a
 * .docx edits it in Word, which has no idea what a CSL style is. Note styles
 * are the exception that Word does better than the editor: Word paginates, so
 * their notes become real footnotes rather than the editor's endnotes.
 *
 * Pure: a document and options in, bytes out. The `docx` package is about
 * 100 KB gzipped, so callers load this module with `import()` when someone
 * exports, not with the editor.
 */

export interface DocxImage {
	data: Uint8Array;
	type: 'png' | 'jpg' | 'gif' | 'bmp';
	/** Pixels, as the image is drawn at 96dpi. */
	width: number;
	height: number;
}

export interface DocxOptions {
	/** The document's title, in its properties. The body carries its own. */
	title?: string;
	/** The page as the author set it up. Word's defaults otherwise. */
	page?: DocxPageSetup;
	/**
	 * The notes a note style rendered, numbered as the citations' `noteIndex`.
	 * Without them, the document's notes section is read instead.
	 */
	notes?: readonly RenderedNote[];
	/**
	 * The images' bytes by their `src`. Reading a file is the caller's job; an
	 * image missing here is written as its alt text in brackets.
	 */
	images?: Readonly<Record<string, DocxImage>>;
}

/**
 * Times New Roman at 12 points is what submission guidelines ask for when they
 * ask for anything, and it's on every machine that opens a .docx: LibreOffice
 * substitutes a metric-compatible face, so the pages break in the same places.
 * The editor's reading font is a preference for the screen, not the paper.
 */
const FONT = 'Times New Roman';
const SIZE = 24; // half-points
const MONO = 'Courier New';

/** Half an inch, Word's own indent step and its default tab. */
const INDENT = 720;

/** One inch, used where the page wasn't given. */
const DEFAULT_PAGE: DocxPageSetup = {
	width: 12240,
	height: 15840,
	margin: 1440,
	spacing: 1.15,
	firstPageBare: false,
	runningHeads: { headerLeft: '', headerRight: '', footerLeft: '', footerRight: '' }
};

const HEADINGS = [
	HeadingLevel.HEADING_1,
	HeadingLevel.HEADING_2,
	HeadingLevel.HEADING_3,
	HeadingLevel.HEADING_4,
	HeadingLevel.HEADING_5,
	HeadingLevel.HEADING_6
] as const;

const ALIGNMENTS: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
	left: AlignmentType.LEFT,
	center: AlignmentType.CENTER,
	right: AlignmentType.RIGHT,
	justify: AlignmentType.JUSTIFIED
};

/** How a run looks: the marks on it, or the markup around it in a citation. */
type Format = {
	-readonly [
		K in
			| 'bold'
			| 'italics'
			| 'strike'
			| 'superScript'
			| 'subScript'
			| 'smallCaps'
			| 'font'
			| 'highlight'
	]?: IRunOptions[K];
} & { underline?: object };

interface Context {
	/** Footnote text by note number, for note styles. */
	notes: Map<number, string>;
	/** The notes actually referenced, which are the ones the file gets. */
	footnotes: Map<number, Paragraph[]>;
	images: Readonly<Record<string, DocxImage>>;
	/** Each ordered list gets its own numbering, so each starts again at 1. */
	numbering: { reference: string; levels: ILevelsOptions[] }[];
	/** The width text can take, in pixels, which an image is shrunk to fit. */
	textWidthPx: number;
}

/** Extra paragraph properties a container puts on what's in it. */
interface Within {
	/** Twips to indent by, from blockquotes and list items. */
	indent: number;
	/** In a table cell: single-spaced, with no paragraph gap. */
	tight?: boolean;
	/** Formatting every run takes, such as a table header's bold. */
	format: Format;
}

const MARKS: Record<string, Format> = {
	bold: { bold: true },
	italic: { italics: true },
	underline: { underline: {} },
	strike: { strike: true },
	code: { font: MONO },
	superscript: { superScript: true },
	subscript: { subScript: true },
	highlight: { highlight: 'yellow' }
};

function markFormat(marks: JSONContent['marks'], base: Format): Format {
	return (marks ?? []).reduce<Format>((format, mark) => ({ ...format, ...MARKS[mark.type] }), base);
}

function linkOf(marks: JSONContent['marks']): string | null {
	const link = marks?.find((mark) => mark.type === 'link');
	const href = link?.attrs?.href;
	return typeof href === 'string' && href ? href : null;
}

// --- Citation HTML -----------------------------------------------------------

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' '
};

function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
		if (name[0] === '#') {
			const code =
				name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
			return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
		}
		return ENTITIES[name.toLowerCase()] ?? whole;
	});
}

/** What a citeproc `style` attribute turns on or off. */
function styleFormat(style: string): Format {
	const format: Format = {};
	for (const declaration of style.split(';')) {
		const [property, value] = declaration.split(':').map((part) => part.trim().toLowerCase());
		if (property === 'font-style') format.italics = value === 'italic' || value === 'oblique';
		if (property === 'font-weight') format.bold = value === 'bold' || Number(value) >= 600;
		if (property === 'font-variant') format.smallCaps = value === 'small-caps';
		if (property === 'text-decoration' && value === 'underline') format.underline = {};
		if (property === 'vertical-align' && value === 'sup') format.superScript = true;
		if (property === 'vertical-align' && value === 'sub') format.subScript = true;
	}
	return format;
}

const TAG_FORMATS: Record<string, Format> = {
	i: { italics: true },
	em: { italics: true },
	b: { bold: true },
	strong: { bold: true },
	sup: { superScript: true },
	sub: { subScript: true }
};

/**
 * Citeproc's HTML as runs.
 *
 * Its whole output surface is `div` and `i` with classes, plus the inline
 * markup `sanitize.ts` allows: italics, bold, small caps in a `style`, super-
 * and subscripts and links. No DOM: this has to run where the tests do, and the
 * input is already sanitized, so a tokenizer over that small grammar is enough.
 * The text goes into Word through `docx`, which escapes it for XML.
 *
 * IEEE puts the number in a `csl-left-margin` div and the entry beside it, so
 * that div ends in a tab, which the entry's hanging indent lines up.
 */
export function htmlRuns(html: string, base: Format = {}): TextRun[] {
	const runs: TextRun[] = [];
	const stack: { tag: string; format: Format; tab: boolean }[] = [];
	const current = () => stack.at(-1)?.format ?? base;

	// Citeproc indents its divs with newlines and spaces, which a browser
	// collapses and Word would print.
	const source = html.replace(/\s*(<\/?div\b[^>]*>)\s*/gi, '$1').replace(/[ \t\r\n]+/g, ' ');

	for (const [, closing, tag, attrs, text] of source.matchAll(
		/<(\/?)([a-z][a-z0-9]*)([^>]*)>|([^<]+)/gi
	)) {
		if (text !== undefined) {
			const decoded = decodeEntities(text);
			if (decoded) runs.push(new TextRun({ text: decoded, ...current() }));
			continue;
		}

		const name = tag.toLowerCase();
		if (name === 'br') {
			runs.push(new TextRun({ break: 1, ...current() }));
			continue;
		}

		if (closing) {
			const index = stack.findLastIndex((entry) => entry.tag === name);
			if (index === -1) continue;
			const [closed] = stack.splice(index);
			if (closed.tab) runs.push(new TextRun({ children: [new Tab()], ...current() }));
			continue;
		}

		if (attrs.trim().endsWith('/')) continue;
		const style = /style\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? '';
		const tab = name === 'div' && /class\s*=\s*"[^"]*\bcsl-left-margin\b/i.test(attrs);
		stack.push({
			tag: name,
			format: { ...current(), ...TAG_FORMATS[name], ...styleFormat(style) },
			tab
		});
	}

	return runs;
}

// --- Inline content ----------------------------------------------------------

function inlines(nodes: readonly JSONContent[] | undefined, ctx: Context, within: Within) {
	const children: ParagraphChild[] = [];

	for (const node of nodes ?? []) {
		switch (node.type) {
			case 'text': {
				const format = markFormat(node.marks, within.format);
				const href = linkOf(node.marks);
				if (!href) {
					children.push(new TextRun({ text: node.text ?? '', ...format }));
					break;
				}
				// A link stays a link, so the DOI in a sentence still opens.
				children.push(
					new ExternalHyperlink({
						link: href,
						children: [new TextRun({ text: node.text ?? '', style: 'Hyperlink', ...format })]
					})
				);
				break;
			}

			case 'hardBreak':
				children.push(new TextRun({ break: 1 }));
				break;

			case 'citation':
				children.push(...citation(node, ctx, markFormat(node.marks, within.format)));
				break;

			case 'image':
				children.push(image(node, ctx));
				break;

			default:
				children.push(...inlines(node.content, ctx, within));
		}
	}

	return children;
}

function citation(node: JSONContent, ctx: Context, format: Format): ParagraphChild[] {
	const label = typeof node.attrs?.label === 'string' ? node.attrs.label : '';
	const index = Number(node.attrs?.noteIndex ?? 0);
	const note = index > 0 ? ctx.notes.get(index) : undefined;

	// A note style's citation is a note: the sentence keeps a reference mark,
	// and the citation goes to the foot of the page, as Word numbers it.
	if (note !== undefined) {
		if (!ctx.footnotes.has(index)) {
			// The space Word itself puts between a footnote's number and its text.
			ctx.footnotes.set(index, [
				new Paragraph({ style: 'FootnoteText', children: [new TextRun(' '), ...htmlRuns(note)] })
			]);
		}
		return [new FootnoteReferenceRun(index)];
	}

	// A note number whose note can't be found is still a mark in the text,
	// rather than a bare digit in the sentence.
	if (index > 0) return htmlRuns(label, { ...format, superScript: true });
	return htmlRuns(label, format);
}

function image(node: JSONContent, ctx: Context): ParagraphChild {
	const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
	const alt = typeof node.attrs?.alt === 'string' && node.attrs.alt ? node.attrs.alt : 'image';
	const found = ctx.images[src];

	// Said in the document rather than dropped, so a figure that didn't come
	// across is noticed before the file is sent anywhere.
	if (!found) return new TextRun({ text: `[${alt}]`, italics: true });

	// No wider than the text, keeping its shape, as the editor draws it.
	const scale = Math.min(1, ctx.textWidthPx / found.width);
	return new ImageRun({
		type: found.type,
		data: found.data,
		transformation: {
			width: Math.round(found.width * scale),
			height: Math.round(found.height * scale)
		},
		altText: { name: alt, description: alt, title: alt }
	});
}

// --- Blocks ------------------------------------------------------------------

type Block = Paragraph | Table;

function paragraph(options: IParagraphOptions, within: Within) {
	return new Paragraph({
		...options,
		indent: within.indent ? { left: within.indent, ...options.indent } : options.indent,
		// Solid in a table, as journals' own templates set them: double-spaced
		// cells make a short table run over several pages.
		spacing: within.tight ? { after: 0, line: 240, lineRule: LineRuleType.AUTO } : options.spacing
	});
}

function alignment(node: JSONContent) {
	const align = node.attrs?.textAlign;
	return typeof align === 'string' ? ALIGNMENTS[align] : undefined;
}

function blocks(nodes: readonly JSONContent[] | undefined, ctx: Context, within: Within): Block[] {
	return (nodes ?? []).flatMap((node) => block(node, ctx, within));
}

function block(node: JSONContent, ctx: Context, within: Within): Block[] {
	switch (node.type) {
		case 'paragraph':
			return [
				paragraph(
					{ alignment: alignment(node), children: inlines(node.content, ctx, within) },
					within
				)
			];

		case 'heading': {
			const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), HEADINGS.length);
			return [
				paragraph(
					{
						heading: HEADINGS[level - 1],
						alignment: alignment(node),
						children: inlines(node.content, ctx, within)
					},
					within
				)
			];
		}

		case 'bulletList':
		case 'orderedList':
			return list(node, ctx, within, 0);

		case 'blockquote':
			return blocks(node.content, ctx, { ...within, indent: within.indent + INDENT });

		case 'codeBlock': {
			const lines = (node.content ?? [])
				.map((child) => child.text ?? '')
				.join('')
				.split('\n');
			return [
				paragraph(
					{
						children: lines.map(
							(line, i) => new TextRun({ text: line, font: MONO, break: i > 0 ? 1 : undefined })
						)
					},
					within
				)
			];
		}

		case 'horizontalRule':
			return [paragraph({ thematicBreak: true }, within)];

		case PAGE_BREAK_NODE:
			return [new Paragraph({ children: [new PageBreak()] })];

		case 'image':
			return [paragraph({ alignment: AlignmentType.CENTER, children: [image(node, ctx)] }, within)];

		case 'table':
			return [table(node, ctx, within)];

		case BIBLIOGRAPHY_NODE:
			return bibliography(node);

		case NOTES_NODE:
			// The notes are footnotes in Word, each at its citation. A section of
			// them at the end as well would print every reference twice.
			return [];

		default:
			return blocks(node.content, ctx, within);
	}
}

/**
 * A list, its items numbered or bulleted by Word rather than typed in, so a
 * co-author adding an item gets the next number.
 *
 * Later paragraphs in an item line up under the first one's text, unmarked.
 */
function list(node: JSONContent, ctx: Context, within: Within, level: number): Block[] {
	const ordered = node.type === 'orderedList';
	let reference = 'bullet';
	if (ordered) {
		reference = `ordered-${ctx.numbering.length + 1}`;
		const start = Math.max(1, Number(node.attrs?.start ?? 1) || 1);
		ctx.numbering.push({ reference, levels: orderedLevels(level, start) });
	}

	const indent = INDENT * (level + 1);
	return (node.content ?? []).flatMap((item) =>
		(item.content ?? []).flatMap((child, i) => {
			if (child.type === 'bulletList' || child.type === 'orderedList') {
				return list(child, ctx, within, level + 1);
			}
			if (i === 0 && child.type === 'paragraph') {
				return [
					paragraph(
						{
							numbering: { reference, level },
							alignment: alignment(child),
							children: inlines(child.content, ctx, within)
						},
						within
					)
				];
			}
			return block(child, ctx, { ...within, indent: within.indent + indent });
		})
	);
}

const ORDERED_FORMATS = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];
const BULLETS = ['•', '◦', '▪'];

function levelIndent(level: number) {
	return { indent: { left: INDENT * (level + 1), hanging: INDENT / 2 } };
}

/** An ordered list's levels, with the number it starts at on its own level. */
function orderedLevels(startLevel: number, start: number): ILevelsOptions[] {
	return Array.from({ length: 9 }, (_, level) => ({
		level,
		format: ORDERED_FORMATS[level % ORDERED_FORMATS.length],
		text: `%${level + 1}.`,
		start: level === startLevel ? start : 1,
		alignment: AlignmentType.START,
		style: { paragraph: levelIndent(level) }
	}));
}

const BULLET_LEVELS: ILevelsOptions[] = Array.from({ length: 9 }, (_, level) => ({
	level,
	format: LevelFormat.BULLET,
	text: BULLETS[level % BULLETS.length],
	alignment: AlignmentType.START,
	style: { paragraph: levelIndent(level) }
}));

function table(node: JSONContent, ctx: Context, within: Within): Table {
	return new Table({
		width: { size: 100, type: WidthType.PERCENTAGE },
		rows: (node.content ?? []).map((row) => {
			const cells = row.content ?? [];
			return new TableRow({
				// A header row repeats on every page the table crosses.
				tableHeader: cells.length > 0 && cells.every((cell) => cell.type === 'tableHeader'),
				// A row read across a page break is a row misread.
				cantSplit: true,
				children: cells.map((cell) => {
					const content = blocks(cell.content, ctx, {
						indent: 0,
						tight: true,
						format: cell.type === 'tableHeader' ? { ...within.format, bold: true } : within.format
					});
					return new TableCell({
						columnSpan: Number(cell.attrs?.colspan ?? 1) || 1,
						rowSpan: Number(cell.attrs?.rowspan ?? 1) || 1,
						// A cell must hold a paragraph, even an empty one.
						children: content.length ? content : [new Paragraph({})]
					});
				})
			});
		})
	});
}

/**
 * The references as citeproc rendered them, with the hanging indent author-date
 * styles use. The editor's warning about sources no longer in the library is
 * for the author, not the reader, so it isn't written.
 */
function bibliography(node: JSONContent): Block[] {
	const entries: string[] = Array.isArray(node.attrs?.entries) ? node.attrs.entries : [];
	return [
		new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('References')] }),
		...entries.map(
			(entry) =>
				new Paragraph({
					indent: { left: INDENT, hanging: INDENT },
					children: htmlRuns(entry)
				})
		)
	];
}

// --- Page --------------------------------------------------------------------

/** A running head's text, with `{page}` and `{total}` as Word's own fields. */
function headText(template: string): (string | (typeof PageNumber)[keyof typeof PageNumber])[] {
	return template
		.split(/(\{page\}|\{total\})/)
		.filter(Boolean)
		.map((part) =>
			part === '{page}' ? PageNumber.CURRENT : part === '{total}' ? PageNumber.TOTAL_PAGES : part
		);
}

/** Two slots, left and right, as the editor has them: the right one on a right tab. */
function headParagraph(left: string, right: string, textWidth: number) {
	return new Paragraph({
		tabStops: [{ type: TabStopType.RIGHT, position: textWidth }],
		children: [
			new TextRun({
				children: [...headText(left), ...(right ? [new Tab(), ...headText(right)] : [])]
			})
		]
	});
}

function runningHeads(page: DocxPageSetup) {
	const textWidth = page.width - 2 * page.margin;
	const heads = page.runningHeads;
	const hasHeader = Boolean(heads.headerLeft || heads.headerRight);
	const hasFooter = Boolean(heads.footerLeft || heads.footerRight);
	// Given outright for a bare first page, because LibreOffice reads a missing
	// first-page header as "the same as the rest".
	const bare = () => [new Paragraph({})];

	return {
		headers: hasHeader
			? {
					default: new Header({
						children: [headParagraph(heads.headerLeft, heads.headerRight, textWidth)]
					}),
					...(page.firstPageBare ? { first: new Header({ children: bare() }) } : {})
				}
			: undefined,
		footers: hasFooter
			? {
					default: new Footer({
						children: [headParagraph(heads.footerLeft, heads.footerRight, textWidth)]
					}),
					...(page.firstPageBare ? { first: new Footer({ children: bare() }) } : {})
				}
			: undefined
	};
}

const heading = (size: number, italics = false) => ({
	run: { font: FONT, size, bold: true, italics, color: '000000' },
	paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, keepLines: true }
});

/** The document as Word bytes. */
export async function toDocx(doc: JSONContent, options: DocxOptions = {}): Promise<Uint8Array> {
	const page = options.page ?? DEFAULT_PAGE;
	const notes = options.notes ?? notesOf(doc);

	const ctx: Context = {
		notes: new Map(notes.map((note) => [note.index, note.text])),
		footnotes: new Map(),
		images: options.images ?? {},
		numbering: [],
		textWidthPx: ((page.width - 2 * page.margin) / 1440) * 96
	};

	const children = blocks(doc.content, ctx, { indent: 0, format: {} });
	const document = new Document({
		title: options.title,
		creator: 'Erti',
		styles: {
			default: {
				document: {
					run: { font: FONT, size: SIZE },
					paragraph: {
						// Word's "multiple" spacing is in 240ths of a line: 1.15 is
						// Word's own single, 276.
						spacing: {
							line: Math.round(page.spacing * 240),
							lineRule: LineRuleType.AUTO,
							after: 240
						}
					}
				},
				heading1: heading(32),
				heading2: heading(28),
				heading3: heading(26),
				heading4: heading(SIZE),
				heading5: heading(SIZE, true),
				heading6: heading(SIZE, true),
				// Lists are one block: no paragraph gap between their items.
				listParagraph: { paragraph: { contextualSpacing: true } },
				// Notes are set small and solid, whatever the body's spacing, as
				// every style guide that asks for double spacing allows.
				footnoteText: {
					run: { size: 20 },
					paragraph: { spacing: { line: 240, lineRule: LineRuleType.AUTO, after: 0 } }
				}
			}
		},
		numbering: {
			config: [{ reference: 'bullet', levels: BULLET_LEVELS }, ...ctx.numbering]
		},
		footnotes: Object.fromEntries(
			[...ctx.footnotes].map(([index, paragraphs]) => [index, { children: paragraphs }])
		),
		sections: [
			{
				properties: {
					page: {
						size: { width: page.width, height: page.height },
						margin: {
							top: page.margin,
							bottom: page.margin,
							left: page.margin,
							right: page.margin,
							// Halfway into the margin: Word's half inch at its one-inch
							// default, and clear of the text at a narrow one.
							header: Math.round(page.margin / 2),
							footer: Math.round(page.margin / 2)
						}
					},
					titlePage: page.firstPageBare
				},
				...runningHeads(page),
				// Word won't open a body with nothing in it.
				children: children.length ? children : [new Paragraph({})]
			}
		]
	});

	return new Uint8Array(await Packer.toArrayBuffer(document));
}

/** The notes the document's notes section holds, when the caller has none. */
function notesOf(doc: JSONContent): RenderedNote[] {
	const found: RenderedNote[] = [];
	const visit = (node: JSONContent) => {
		if (node.type === NOTES_NODE && Array.isArray(node.attrs?.notes)) {
			found.push(...(node.attrs.notes as RenderedNote[]));
		}
		node.content?.forEach(visit);
	};
	visit(doc);
	return found;
}
