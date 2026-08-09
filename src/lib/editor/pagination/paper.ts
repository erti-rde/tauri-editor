/**
 * The page, as one description that both the screen and the printer read.
 *
 * This is the part that has to be ours. Pagination on screen is done by
 * measuring pixels; a PDF is produced by `@page`, which works in inches and
 * millimetres. If those two disagree the editor shows five pages and the
 * export has six — and the author finds out from a journal, not from us.
 *
 * So physical size is the source of truth and pixels are derived from it, at
 * the 96dpi the CSS pixel is defined against. The pagination library ships its
 * own constants, and US Letter there is 1060x818 where the true value is
 * 1056x816: four pixels a page, which is most of a line by page twenty.
 */

/** CSS defines one inch as exactly 96 pixels; a millimetre follows from that. */
const PX_PER_INCH = 96;
const PX_PER_MM = PX_PER_INCH / 25.4;

export type PaperId = 'letter' | 'a4' | 'legal';

export interface Paper {
	id: PaperId;
	label: string;
	/** What `@page { size: … }` is given, and what the printer works in. */
	css: string;
	/** The same page at 96dpi, which is what on-screen pagination measures. */
	widthPx: number;
	heightPx: number;
}

const inches = (n: number) => Math.round(n * PX_PER_INCH);
const mm = (n: number) => Math.round(n * PX_PER_MM);

export const PAPERS: readonly Paper[] = [
	{
		id: 'letter',
		label: 'US Letter',
		css: 'letter',
		widthPx: inches(8.5),
		heightPx: inches(11)
	},
	{
		id: 'a4',
		label: 'A4',
		css: 'A4',
		widthPx: mm(210),
		heightPx: mm(297)
	},
	{
		id: 'legal',
		label: 'US Legal',
		css: 'legal',
		widthPx: inches(8.5),
		heightPx: inches(14)
	}
];

export const DEFAULT_PAPER: PaperId = 'letter';

export function paperById(id: string): Paper {
	return PAPERS.find((p) => p.id === id) ?? PAPERS[0];
}

/**
 * Margins, in inches because that is the unit every submission guideline uses.
 *
 * "One inch on all sides" is what journals ask for and what Word gives by
 * default, so a manuscript written here matches the one a co-author sends back.
 */
export type MarginId = 'narrow' | 'normal' | 'wide';

export interface Margins {
	id: MarginId;
	label: string;
	/** Inches. Uniform on all four sides, which is what guidelines specify. */
	inches: number;
}

export const MARGINS: readonly Margins[] = [
	{ id: 'narrow', label: 'Narrow', inches: 0.5 },
	{ id: 'normal', label: 'Normal', inches: 1 },
	{ id: 'wide', label: 'Wide', inches: 1.5 }
];

export const DEFAULT_MARGIN: MarginId = 'normal';

export function marginById(id: string): Margins {
	return MARGINS.find((m) => m.id === id) ?? MARGINS[1];
}

/**
 * What runs across the top and bottom of every page.
 *
 * Two slots a side, because that is what the underlying pagination supports and
 * what a manuscript actually needs: a running title on one side, a page number
 * on the other. `{page}` and `{total}` are substituted per page.
 */
export interface RunningHeads {
	headerLeft: string;
	headerRight: string;
	footerLeft: string;
	footerRight: string;
}

/**
 * Empty above, a page number below.
 *
 * Every submission guideline asks for a page number and none of them ask for
 * anything else, so that is the whole default. A running title is a per-journal
 * requirement rather than a general one, and an author name in the header is
 * the thing that breaks anonymised peer review — neither belongs in a default
 * someone has to notice and remove.
 */
export const DEFAULT_RUNNING_HEADS: RunningHeads = {
	headerLeft: '',
	headerRight: '',
	footerLeft: '',
	footerRight: 'Page {page} of {total}'
};

export interface PageSetup {
	paper: PaperId;
	margin: MarginId;
	/** Pages as pages, rather than one unbroken scroll. */
	paginate: boolean;
	runningHeads: RunningHeads;
}

export const DEFAULT_PAGE_SETUP: PageSetup = {
	paper: DEFAULT_PAPER,
	margin: DEFAULT_MARGIN,
	paginate: true,
	runningHeads: DEFAULT_RUNNING_HEADS
};

/** Read a stored setup, keeping whatever is usable and defaulting the rest. */
export function normalisePageSetup(raw: Partial<PageSetup> | null | undefined): PageSetup {
	if (!raw || typeof raw !== 'object') return { ...DEFAULT_PAGE_SETUP };

	// Partial<RunningHeads> rather than RunningHeads: this is a file on disk that
	// can be hand-edited, so any of the four may be missing or the wrong type.
	const heads: Partial<RunningHeads> = raw.runningHeads ?? {};
	const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);

	return {
		paper: paperById(String(raw.paper)).id,
		margin: marginById(String(raw.margin)).id,
		// Only an explicit false turns pagination off, so a settings file written
		// before this existed still gets pages.
		paginate: raw.paginate !== false,
		runningHeads: {
			headerLeft: text(heads.headerLeft, DEFAULT_RUNNING_HEADS.headerLeft),
			headerRight: text(heads.headerRight, DEFAULT_RUNNING_HEADS.headerRight),
			footerLeft: text(heads.footerLeft, DEFAULT_RUNNING_HEADS.footerLeft),
			footerRight: text(heads.footerRight, DEFAULT_RUNNING_HEADS.footerRight)
		}
	};
}

/**
 * The setup as the on-screen paginator wants it: pixels, all of them derived.
 *
 * `contentMargin` is deliberately zero. The vertical margin is already the
 * page's own, and adding a second one here is what makes the last line of a
 * page fall off the bottom of the printed sheet.
 */
export function toPixelConfig(setup: PageSetup) {
	const paper = paperById(setup.paper);
	const margin = Math.round(marginById(setup.margin).inches * PX_PER_INCH);

	return {
		pageWidth: paper.widthPx,
		pageHeight: paper.heightPx,
		marginTop: margin,
		marginBottom: margin,
		marginLeft: margin,
		marginRight: margin,
		contentMarginTop: 0,
		contentMarginBottom: 0
	};
}

/**
 * The same setup as printer instructions.
 *
 * Emitted into a live <style> element rather than written into the stylesheet,
 * because `@page` takes no custom properties: `size: var(--paper)` is not valid
 * CSS, which is why page size could not be a setting before.
 *
 * The margin depends on who is drawing it, and getting this wrong is the
 * classic doubled-margin bug. When the page is paginated on screen, each page
 * box already carries the margin as real layout, so `@page` must contribute
 * nothing or the PDF comes out with two inches where one was asked for. With
 * pagination off there is no page box, the manuscript is one column, and the
 * margin has to come from here instead.
 */
export function toPageRule(setup: PageSetup): string {
	const paper = paperById(setup.paper);
	const margin = setup.paginate ? 0 : marginById(setup.margin).inches;

	return `@page { size: ${paper.css}; margin: ${margin}in; }`;
}

/** Substitute the page placeholders. Used for the print-time running heads. */
export function fillPlaceholders(template: string, page: number, total: number): string {
	return template.replaceAll('{page}', String(page)).replaceAll('{total}', String(total));
}
